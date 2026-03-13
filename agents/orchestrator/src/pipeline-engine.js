const axios = require("axios");
const fs = require("fs");
const path = require("path");

class PipelineEngine {
  constructor(logger, client, options = {}) {
    this.logger = logger;
    this.client = client;
    this.maxDepth = options.maxDepth || 50;
    this.enableDLQ = options.enableDLQ !== false;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.variables = options.variables || {};
    this.rateLimitMs = options.rateLimitMs || 0;
    this.dlq = [];
    this.stepMetrics = {};
    this.lastHttpCall = 0;
  }

  async execute(pipeline) {
    this.logger.info(`Pipeline: "${pipeline.name}"`);
    const startTime = Date.now();
    let data = pipeline.initialData || null;
    let stepsExecuted = 0;
    let stepsSkipped = 0;

    for (let i = 0; i < pipeline.steps.length; i++) {
      if (i >= this.maxDepth) {
        this.logger.error(`Circuit breaker at step ${i} (max depth: ${this.maxDepth})`);
        break;
      }

      const step = pipeline.steps[i];

      // Conditional execution
      if (step.condition) {
        const shouldRun = this._evaluateCondition(step.condition, data);
        if (!shouldRun) {
          this.logger.info(`  skip: ${step.id} (condition not met)`);
          stepsSkipped++;
          continue;
        }
      }

      if (step.type === "parallel") {
        data = await this._executeParallel(step, data, i, pipeline.steps.length);
        stepsExecuted++;
        continue;
      }

      if (step.type === "branch") {
        data = await this._executeBranch(step, data);
        stepsExecuted++;
        continue;
      }

      data = await this._executeStepWithRetry(step, data, i, pipeline.steps.length);
      stepsExecuted++;
      if (data === null && step.config?.stopOnNull) break;
    }

    const duration = Date.now() - startTime;
    this.logger.info(`Pipeline "${pipeline.name}" complete`, {
      duration: `${duration}ms`,
      executed: stepsExecuted,
      skipped: stepsSkipped,
      dlq: this.dlq.length,
    });

    if (this.client.agentId) {
      await this.client.reportLog("info", `Pipeline complete: ${pipeline.name}`, {
        duration,
        stepsExecuted,
        stepsSkipped,
        dlqSize: this.dlq.length,
        metrics: this.stepMetrics,
      });
    }

    return data;
  }

  async _executeStepWithRetry(step, inputData, index, total) {
    const maxAttempts = (step.retries || this.maxRetries) + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const stepStart = Date.now();
      try {
        const retryLabel = attempt > 1 ? ` (retry ${attempt - 1})` : "";
        this.logger.info(`  [${index + 1}/${total}] ${step.type}: ${step.id}${retryLabel}`);

        // Rate limiting for HTTP steps
        if ((step.type === "http-source" || step.type === "http-sink") && this.rateLimitMs > 0) {
          const elapsed = Date.now() - this.lastHttpCall;
          if (elapsed < this.rateLimitMs) {
            const wait = this.rateLimitMs - elapsed;
            this.logger.debug(`  rate-limit: waiting ${wait}ms`);
            await new Promise((r) => setTimeout(r, wait));
          }
        }

        const result = await this._executeStep(step, inputData);
        const duration = Date.now() - stepStart;

        if (step.type === "http-source" || step.type === "http-sink") {
          this.lastHttpCall = Date.now();
        }

        this.stepMetrics[step.id] = { status: "success", duration, attempts: attempt };
        return result;
      } catch (err) {
        const duration = Date.now() - stepStart;

        if (attempt < maxAttempts) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          this.logger.warn(`  FAIL: ${step.id} (attempt ${attempt}) -- ${err.message}, retrying in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        this.stepMetrics[step.id] = { status: "failed", duration, error: err.message, attempts: attempt };
        this.logger.error(`  FAIL: ${step.id} permanently after ${attempt} attempt(s) -- ${err.message}`);

        if (this.enableDLQ) {
          this.dlq.push({
            step: step.id,
            type: step.type,
            error: err.message,
            inputData: typeof inputData === "object" ? JSON.stringify(inputData).substring(0, 1000) : inputData,
            timestamp: new Date().toISOString(),
            attempts: attempt,
          });
        }

        if (step.config?.continueOnError) {
          this.logger.warn(`  -> Continuing (continueOnError: true)`);
          return inputData;
        }

        if (step.fallback) {
          this.logger.info(`  -> Running fallback for ${step.id}`);
          try {
            return await this._executeStep(step.fallback, inputData);
          } catch (fbErr) {
            this.logger.error(`  -> Fallback failed: ${fbErr.message}`);
          }
        }

        throw err;
      }
    }
  }

  async _executeParallel(step, inputData, index, total) {
    this.logger.info(`  [${index + 1}/${total}] parallel: ${step.id} (${step.branches.length} branches)`);
    const startTime = Date.now();

    const results = await Promise.allSettled(
      step.branches.map(async (branch) => {
        let data = inputData;
        for (const subStep of branch.steps) {
          data = await this._executeStep(subStep, data);
        }
        return { name: branch.name, data };
      })
    );

    const output = {};
    let fulfilled = 0;
    let rejected = 0;

    for (const r of results) {
      if (r.status === "fulfilled") {
        output[r.value.name] = r.value.data;
        fulfilled++;
        this.logger.info(`    OK: branch "${r.value.name}"`);
      } else {
        rejected++;
        this.logger.error(`    FAIL: branch -- ${r.reason?.message}`);
        if (this.enableDLQ) {
          this.dlq.push({ step: step.id, type: "parallel-branch", error: r.reason?.message, timestamp: new Date().toISOString() });
        }
      }
    }

    const duration = Date.now() - startTime;
    this.stepMetrics[step.id] = { status: rejected === 0 ? "success" : "partial", duration, fulfilled, rejected };

    if (step.merge === "array") return Object.values(output);
    if (step.merge === "first") return Object.values(output)[0];
    return output;
  }

  async _executeBranch(step, inputData) {
    this.logger.info(`  branch: ${step.id} -- evaluating ${step.cases.length} case(s)`);

    for (const c of step.cases) {
      const match = this._evaluateCondition(c.condition, inputData);
      if (match) {
        this.logger.info(`    -> matched: "${c.name}"`);
        let data = inputData;
        for (const subStep of c.steps) {
          data = await this._executeStep(subStep, data);
        }
        return data;
      }
    }

    if (step.default) {
      this.logger.info(`    -> default case`);
      let data = inputData;
      for (const subStep of step.default) {
        data = await this._executeStep(subStep, data);
      }
      return data;
    }

    this.logger.warn(`    -> no matching case, passing data through`);
    return inputData;
  }

  _evaluateCondition(condition, data) {
    try {
      const fn = new Function("data", "vars", `return (${condition})`);
      return !!fn(data, this.variables);
    } catch {
      return true;
    }
  }

  _interpolateVariables(str) {
    if (typeof str !== "string") return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => this.variables[key] || `{{${key}}}`);
  }

  async _executeStep(step, inputData) {
    switch (step.type) {
      case "http-source": {
        const url = this._interpolateVariables(step.config.url);
        const method = step.config.method || "GET";
        const headers = step.config.headers || {};
        const body = step.config.body;
        const res = await axios({ method, url, headers, data: body, timeout: step.config.timeout || 15000 });
        this.logger.info(`    <- ${res.status} ${url} (${JSON.stringify(res.data).length} bytes)`);
        return res.data;
      }

      case "http-sink": {
        const url = this._interpolateVariables(step.config.url);
        const method = step.config.method || "POST";
        const headers = step.config.headers || {};
        const res = await axios({ method, url, headers, data: inputData, timeout: step.config.timeout || 15000 });
        this.logger.info(`    -> ${res.status} ${url}`);
        return inputData;
      }

      case "transform": {
        const fn = new Function("data", "vars", `return (${step.config.script})(data, vars)`);
        return fn(inputData, this.variables);
      }

      case "filter": {
        const fn = new Function("data", "vars", `return (${step.config.predicate})(data, vars)`);
        if (!fn(inputData, this.variables)) {
          this.logger.info(`    filtered out`);
          return null;
        }
        return inputData;
      }

      case "map": {
        if (!Array.isArray(inputData)) inputData = [inputData];
        const fn = new Function("item", "vars", `return (${step.config.script})(item, vars)`);
        return inputData.map((item) => fn(item, this.variables));
      }

      case "reduce": {
        if (!Array.isArray(inputData)) return inputData;
        const fn = new Function("acc", "item", "vars", `return (${step.config.script})(acc, item, vars)`);
        const initial = step.config.initial !== undefined ? step.config.initial : {};
        return inputData.reduce((acc, item) => fn(acc, item, this.variables), initial);
      }

      case "flatten": {
        if (!Array.isArray(inputData)) return inputData;
        return inputData.flat(step.config?.depth || 1);
      }

      case "delay": {
        const ms = step.config.ms || 1000;
        this.logger.info(`    delay ${ms}ms`);
        await new Promise((r) => setTimeout(r, ms));
        return inputData;
      }

      case "log": {
        const preview = JSON.stringify(inputData, null, 2);
        const truncated = preview.length > 500 ? preview.substring(0, 500) + "\n    ..." : preview;
        this.logger.info(`    data:\n${truncated}`);
        return inputData;
      }

      case "set-var": {
        this.variables[step.config.name] = typeof step.config.value === "function"
          ? step.config.value(inputData)
          : step.config.value || inputData;
        this.logger.info(`    var "${step.config.name}" set`);
        return inputData;
      }

      case "file-read": {
        const filePath = this._interpolateVariables(step.config.path);
        const content = fs.readFileSync(filePath, "utf-8");
        return step.config.json ? JSON.parse(content) : content;
      }

      case "file-write": {
        const filePath = this._interpolateVariables(step.config.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const output = typeof inputData === "string" ? inputData : JSON.stringify(inputData, null, 2);
        fs.writeFileSync(filePath, output);
        this.logger.info(`    written to ${filePath}`);
        return inputData;
      }

      case "assert": {
        const fn = new Function("data", `return (${step.config.test})(data)`);
        if (!fn(inputData)) {
          throw new Error(step.config.message || `Assertion failed at step ${step.id}`);
        }
        this.logger.info(`    assertion passed`);
        return inputData;
      }

      case "batch": {
        // Process array items in configurable batch sizes
        if (!Array.isArray(inputData)) return inputData;
        const batchSize = step.config.size || 10;
        const results = [];
        for (let i = 0; i < inputData.length; i += batchSize) {
          const batch = inputData.slice(i, i + batchSize);
          this.logger.info(`    batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(inputData.length / batchSize)} (${batch.length} items)`);
          if (step.config.script) {
            const fn = new Function("batch", "vars", `return (${step.config.script})(batch, vars)`);
            results.push(...(await fn(batch, this.variables)));
          } else {
            results.push(...batch);
          }
          if (step.config.delayMs) {
            await new Promise((r) => setTimeout(r, step.config.delayMs));
          }
        }
        return results;
      }

      case "dedupe": {
        // Remove duplicates from array based on key
        if (!Array.isArray(inputData)) return inputData;
        const key = step.config.key;
        if (key) {
          const seen = new Set();
          return inputData.filter((item) => {
            const val = item[key];
            if (seen.has(val)) return false;
            seen.add(val);
            return true;
          });
        }
        return [...new Set(inputData)];
      }

      case "sort": {
        if (!Array.isArray(inputData)) return inputData;
        const key = step.config.key;
        const order = step.config.order || "asc";
        return [...inputData].sort((a, b) => {
          const va = key ? a[key] : a;
          const vb = key ? b[key] : b;
          return order === "desc" ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
        });
      }

      default:
        this.logger.warn(`    unknown step type: ${step.type}`);
        return inputData;
    }
  }
}

module.exports = { PipelineEngine };
