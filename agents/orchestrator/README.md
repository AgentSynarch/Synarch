# SYNARCH Orchestrator Agent v2.0

Advanced data pipeline engine — parallel execution, conditional branching, retry logic, persistent DLQ, and 15+ step types.

## Quick Start

```bash
npm install
cp .env.example .env

# Validate your pipeline
npm run validate -- ./pipelines/default.json

# Self-test
npm test

# Launch
npm start
```

## Step Types

| Type | Description |
|------|-------------|
| `http-source` | Fetch data from an HTTP endpoint |
| `http-sink` | Send data to an HTTP endpoint |
| `transform` | Transform data with a JS expression |
| `filter` | Drop events that don't match a predicate |
| `map` | Apply a function to each item in an array |
| `reduce` | Reduce an array to a single value |
| `flatten` | Flatten nested arrays |
| `delay` | Wait N milliseconds |
| `log` | Log current pipeline data |
| `set-var` | Store a pipeline variable |
| `file-read` | Read data from a file |
| `file-write` | Write data to a file |
| `assert` | Validate data and halt if assertion fails |
| `parallel` | Run multiple branches simultaneously |
| `branch` | Conditional branching (if/else) |

## Advanced Features

### Parallel Execution
```json
{
  "id": "fetch-all",
  "type": "parallel",
  "merge": "object",
  "branches": [
    { "name": "api-1", "steps": [{ "id": "f1", "type": "http-source", "config": { "url": "..." } }] },
    { "name": "api-2", "steps": [{ "id": "f2", "type": "http-source", "config": { "url": "..." } }] }
  ]
}
```

### Conditional Branching
```json
{
  "id": "route",
  "type": "branch",
  "cases": [
    { "name": "high-priority", "condition": "data.priority === 'high'", "steps": [...] },
    { "name": "low-priority", "condition": "data.priority === 'low'", "steps": [...] }
  ],
  "default": [{ "id": "fallback", "type": "log", "config": {} }]
}
```

### Retry with Fallback
```json
{
  "id": "risky-step",
  "type": "http-source",
  "retries": 5,
  "config": { "url": "https://unstable-api.example.com" },
  "fallback": { "type": "transform", "config": { "script": "() => ({ error: 'API down', fallback: true })" } }
}
```

### Pipeline Variables
Set `PIPELINE_VAR_*` in `.env` and reference them in configs with `{{variable_name}}`:
```json
{ "type": "http-source", "config": { "url": "{{api_url}}/data" } }
```

## Pipeline Validation
```bash
npm run validate -- ./pipelines/my-pipeline.json
```

## Dead Letter Queue
Failed events are persisted to `./dlq-*.json` files and reported to the Synarch API. DLQ events include the original input data, error message, step ID, and timestamp.
