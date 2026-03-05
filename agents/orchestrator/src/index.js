require("dotenv").config();
const { Logger, COLORS } = require("./logger");
const { SynarchClient } = require("./synarch-client");
const { PipelineEngine } = require("./pipeline-engine");
const fs = require("fs");
const path = require("path");

const logger = new Logger(process.env.LOG_LEVEL || "info");
const client = new SynarchClient(logger);

async function main() {
  console.log(`
${COLORS.cyan}  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   SYNARCH ORCHESTRATOR AGENT  v2.1.0      ║
  ║   Advanced data pipeline engine           ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝${COLORS.reset}
`);

  logger.info("Initializing orchestrator agent", {
    agent: process.env.AGENT_NAME || "unnamed",
    pipeline: process.env.PIPELINE_FILE || "./pipelines/default.json",
    maxDepth: process.env.MAX_PIPELINE_DEPTH || 50,
    retries: process.env.MAX_RETRIES || 3,
    dlq: process.env.ENABLE_DLQ !== "false" ? "enabled" : "disabled",
    pid: process.pid,
    node: process.version,
  });

  const registered = await client.register("orchestrator");
  if (!registered) {
    logger.warn("Running in offline mode -- API unavailable");
  } else {
    logger.info("Connected to Synarch network");
  }

  client.startHeartbeat();

  // Load pipeline
  const pipelineFile = process.env.PIPELINE_FILE || "./pipelines/default.json";
  let pipelineDef;
  try {
    pipelineDef = JSON.parse(fs.readFileSync(pipelineFile, "utf-8"));
    logger.info(`Loaded pipeline: "${pipelineDef.name}"`, { steps: pipelineDef.steps.length, file: pipelineFile });
  } catch (err) {
    logger.error(`Failed to load pipeline from ${pipelineFile}: ${err.message}`);
    logger.info("Falling back to built-in example pipeline");
    pipelineDef = require("./example-pipeline");
  }

  const engine = new PipelineEngine(logger, client, {
    maxDepth: parseInt(process.env.MAX_PIPELINE_DEPTH || "50"),
    enableDLQ: process.env.ENABLE_DLQ !== "false",
    maxRetries: parseInt(process.env.MAX_RETRIES || "3"),
    retryDelay: parseInt(process.env.RETRY_DELAY || "1000"),
    variables: loadVariables(),
    rateLimitMs: parseInt(process.env.RATE_LIMIT_MS || "0"),
  });

  // Run pipeline
  logger.separator("PIPELINE");
  const result = await engine.execute(pipelineDef);

  // DLQ report
  if (engine.dlq.length > 0) {
    logger.warn(`Dead letter queue: ${engine.dlq.length} failed event(s)`);
    const dlqFile = `./dlq-${Date.now()}.json`;
    fs.writeFileSync(dlqFile, JSON.stringify(engine.dlq, null, 2));
    logger.info(`DLQ persisted to ${dlqFile}`);
  }

  // Step metrics summary
  if (Object.keys(engine.stepMetrics).length > 0) {
    logger.separator("STEP METRICS");
    const tableData = Object.entries(engine.stepMetrics).map(([id, m]) => ({
      step: id,
      status: m.status,
      duration: `${m.duration}ms`,
      attempts: m.attempts,
      error: m.error ? m.error.substring(0, 40) : "--",
    }));
    logger.table(tableData);
  }

  // Polling mode
  if (process.env.AUTO_RESTART === "true") {
    const interval = parseInt(process.env.POLL_INTERVAL || "10000");
    logger.info(`Polling mode active -- re-running every ${interval / 1000}s`);
    setInterval(async () => {
      logger.separator("PIPELINE RE-RUN");
      await engine.execute(pipelineDef);
    }, interval);
  } else {
    await client.updateStatus("idle");
    process.exit(0);
  }

  const shutdown = async (signal) => {
    logger.separator("SHUTDOWN");
    logger.info(`Received ${signal}, shutting down...`);
    if (engine.dlq.length > 0) {
      const dlqFile = `./dlq-shutdown-${Date.now()}.json`;
      fs.writeFileSync(dlqFile, JSON.stringify(engine.dlq, null, 2));
      logger.info(`DLQ persisted to ${dlqFile}`);
    }
    await client.updateStatus("offline");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function loadVariables() {
  const vars = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith("PIPELINE_VAR_")) {
      vars[key.replace("PIPELINE_VAR_", "").toLowerCase()] = val;
    }
  }
  return vars;
}

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
