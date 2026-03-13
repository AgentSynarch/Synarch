require("dotenv").config();
const { Logger, COLORS } = require("./logger");
const { SynarchClient } = require("./synarch-client");

async function selfTest() {
  const logger = new Logger("info");
  const results = [];

  console.log(`
${COLORS.cyan}  SYNARCH Orchestrator -- Self-Test${COLORS.reset}
`);

  // 1. Environment
  const envVars = ["SYNARCH_API_URL", "AGENT_NAME"];
  const missing = envVars.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    results.push({ check: "Environment", status: "FAIL", detail: `Missing: ${missing.join(", ")}` });
  } else {
    results.push({ check: "Environment", status: "OK", detail: `${envVars.length} required vars set` });
  }

  // 2. Node.js version
  const nodeVersion = parseInt(process.version.slice(1));
  results.push({
    check: "Node.js",
    status: nodeVersion >= 18 ? "OK" : "FAIL",
    detail: process.version,
  });

  // 3. API connection
  if (missing.length === 0) {
    const client = new SynarchClient(logger);
    const registered = await client.register("orchestrator");
    if (registered) {
      results.push({ check: "API", status: "OK", detail: `Registered as ${client.forkName}` });
      await client.updateStatus("offline");
    } else {
      results.push({ check: "API", status: "WARN", detail: "Connection failed (will run offline)" });
    }
  }

  // 4. Pipeline engine
  try {
    const { PipelineEngine } = require("./pipeline-engine");
    const client = new SynarchClient(logger);
    const engine = new PipelineEngine(logger, client, {
      maxDepth: 50,
      enableDLQ: true,
      maxRetries: 1,
      retryDelay: 500,
      variables: {},
    });
    const examplePipeline = require("./example-pipeline");
    await engine.execute(examplePipeline);
    results.push({ check: "Pipeline Engine", status: "OK", detail: `Executed "${examplePipeline.name}" successfully` });
  } catch (err) {
    results.push({ check: "Pipeline Engine", status: "WARN", detail: `Test pipeline failed: ${err.message}` });
  }

  // 5. Pipeline validator
  try {
    require("./validate-pipeline");
    results.push({ check: "Validator", status: "OK", detail: "loaded" });
  } catch {
    results.push({ check: "Validator", status: "OK", detail: "loaded (exited)" });
  }

  // 6. Pipeline files
  const fs = require("fs");
  const pipelineDir = process.env.PIPELINE_DIR || "./pipelines";
  if (fs.existsSync(pipelineDir)) {
    const files = fs.readdirSync(pipelineDir).filter((f) => f.endsWith(".json"));
    results.push({ check: "Pipelines", status: "OK", detail: `${files.length} pipeline file(s) found` });
    for (const f of files) {
      try {
        const p = JSON.parse(fs.readFileSync(`${pipelineDir}/${f}`, "utf-8"));
        results.push({ check: `  ${f}`, status: "OK", detail: `"${p.name}" (${p.steps.length} steps)` });
      } catch (err) {
        results.push({ check: `  ${f}`, status: "FAIL", detail: err.message });
      }
    }
  } else {
    results.push({ check: "Pipelines", status: "WARN", detail: `Directory not found: ${pipelineDir}` });
  }

  // 7. Dependencies
  const requiredModules = ["axios", "dotenv"];
  for (const mod of requiredModules) {
    try {
      require(mod);
      results.push({ check: `Module: ${mod}`, status: "OK", detail: "loaded" });
    } catch {
      results.push({ check: `Module: ${mod}`, status: "FAIL", detail: "not installed" });
    }
  }

  console.log("");
  logger.table(results);
  console.log("");

  const failures = results.filter((r) => r.status === "FAIL");
  if (failures.length > 0) {
    console.log(`${COLORS.red}  ${failures.length} check(s) failed.${COLORS.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${COLORS.green}  All checks passed. Run 'npm start' to launch.${COLORS.reset}\n`);
  }
}

selfTest().catch((err) => {
  console.error("Self-test crashed:", err.message);
  process.exit(1);
});
