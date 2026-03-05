const fs = require("fs");

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function validatePipeline(filePath) {
  console.log(`\n${COLORS.cyan}  SYNARCH Pipeline Validator${COLORS.reset}\n`);
  console.log(`  File: ${filePath}\n`);

  let pipeline;
  try {
    pipeline = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.log(`  ${COLORS.red}FAIL${COLORS.reset} Invalid JSON: ${err.message}`);
    process.exit(1);
  }

  const errors = [];
  const warnings = [];

  if (!pipeline.name) errors.push("Missing 'name' field");
  if (!pipeline.steps || !Array.isArray(pipeline.steps)) {
    errors.push("Missing or invalid 'steps' array");
  } else {
    const ids = new Set();
    const validTypes = [
      "http-source", "http-sink", "transform", "filter", "map", "reduce",
      "flatten", "delay", "log", "set-var", "file-read", "file-write",
      "assert", "parallel", "branch", "batch", "dedupe", "sort",
    ];

    pipeline.steps.forEach((step, i) => {
      if (!step.id) errors.push(`Step ${i}: missing 'id'`);
      if (!step.type) errors.push(`Step ${i}: missing 'type'`);
      if (step.id && ids.has(step.id)) errors.push(`Step ${i}: duplicate id '${step.id}'`);
      if (step.id) ids.add(step.id);
      if (step.type && !validTypes.includes(step.type)) warnings.push(`Step ${i} (${step.id}): unknown type '${step.type}'`);
      if (step.type === "http-source" && !step.config?.url) errors.push(`Step ${i} (${step.id}): http-source requires config.url`);
      if (step.type === "http-sink" && !step.config?.url) errors.push(`Step ${i} (${step.id}): http-sink requires config.url`);
      if (step.type === "transform" && !step.config?.script) errors.push(`Step ${i} (${step.id}): transform requires config.script`);
      if (step.type === "filter" && !step.config?.predicate) errors.push(`Step ${i} (${step.id}): filter requires config.predicate`);
      if (step.type === "map" && !step.config?.script) errors.push(`Step ${i} (${step.id}): map requires config.script`);
      if (step.type === "reduce" && !step.config?.script) errors.push(`Step ${i} (${step.id}): reduce requires config.script`);
      if (step.type === "parallel" && !step.branches) errors.push(`Step ${i} (${step.id}): parallel requires 'branches' array`);
      if (step.type === "branch" && !step.cases) errors.push(`Step ${i} (${step.id}): branch requires 'cases' array`);
      if (step.type === "assert" && !step.config?.test) errors.push(`Step ${i} (${step.id}): assert requires config.test`);
    });

    // Validate parallel branch structure
    pipeline.steps.filter((s) => s.type === "parallel").forEach((step) => {
      if (step.branches) {
        step.branches.forEach((branch, bi) => {
          if (!branch.name) warnings.push(`${step.id}: branch ${bi} missing 'name'`);
          if (!branch.steps || !Array.isArray(branch.steps)) errors.push(`${step.id}: branch ${bi} missing 'steps' array`);
        });
      }
      if (step.merge && !["object", "array", "first"].includes(step.merge)) {
        warnings.push(`${step.id}: unknown merge strategy '${step.merge}' (use: object, array, first)`);
      }
    });
  }

  // Print results
  if (errors.length > 0) {
    console.log(`  ${COLORS.red}Errors (${errors.length}):${COLORS.reset}`);
    errors.forEach((e) => console.log(`    ${COLORS.red}x${COLORS.reset} ${e}`));
  }
  if (warnings.length > 0) {
    console.log(`  ${COLORS.yellow}Warnings (${warnings.length}):${COLORS.reset}`);
    warnings.forEach((w) => console.log(`    ${COLORS.yellow}!${COLORS.reset} ${w}`));
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`  ${COLORS.green}OK${COLORS.reset} Pipeline "${pipeline.name}" is valid (${pipeline.steps.length} steps)\n`);
  }
  if (errors.length === 0 && warnings.length > 0) {
    console.log(`\n  ${COLORS.yellow}Valid with warnings.${COLORS.reset}\n`);
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

const file = process.argv[2] || "./pipelines/default.json";
validatePipeline(file);
