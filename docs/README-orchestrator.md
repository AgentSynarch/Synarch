# Synarch Orchestrator

JSON-driven data pipeline agent for the Synarch network. Manages multi-step data flows with parallel execution, conditional branching, retry logic, variable interpolation, and persistent dead-letter queues.

---

## Quickstart

```sh
git clone https://github.com/AgentSynarch/synarch-orchestrator.git
cd synarch-orchestrator
npm install
echo "AGENT_TOKEN=<your-token>" > .env
npm start
```

Get your `AGENT_TOKEN` from the [Synarch launch page](https://synarch.app/launch) by clicking the Orchestrator card.

> **Requirements:** Node.js 18+, npm

---

## What it does

The orchestrator agent executes data pipelines defined as JSON files. Pipelines are sequences of typed steps that fetch, transform, filter, branch, and output data. Steps can run in parallel, retry on failure, and route data conditionally.

### Built-in step types

| Type | Description |
|------|-------------|
| `http-source` | Fetch data from an HTTP endpoint (GET, POST, etc.) |
| `http-sink` | Send data to an HTTP endpoint |
| `transform` | Apply a JavaScript function to the data |
| `filter` | Pass or reject data based on a predicate |
| `map` | Apply a function to each element of an array |
| `reduce` | Reduce an array to a single value |
| `flatten` | Flatten nested arrays by configurable depth |
| `delay` | Pause execution for a specified duration |
| `log` | Log current data state (truncated to 500 chars) |
| `set-var` | Store a value in the pipeline variable context |
| `file-read` | Read a local file (plain text or JSON) |
| `file-write` | Write data to a local file |
| `assert` | Validate data with a test function (throws on failure) |
| `parallel` | Execute multiple branches concurrently |
| `branch` | Conditional routing with case matching and default fallback |

---

## How it works

### Execution flow

```
Load pipeline JSON
  |
  |-- For each step:
  |     |-- Evaluate condition (skip if false)
  |     |-- Check step type:
  |     |     |-- "parallel" -> run branches with Promise.allSettled
  |     |     |-- "branch"   -> evaluate cases, run matching branch
  |     |     |-- other      -> execute with retry logic
  |     |-- On success: record metrics, pass data to next step
  |     |-- On failure:
  |     |     |-- Retry with exponential backoff
  |     |     |-- If continueOnError: pass input data through
  |     |     |-- If fallback defined: execute fallback step
  |     |     |-- Otherwise: push to dead-letter queue, throw
  |
  |-- Report completion to network
```

### Parallel execution

The `parallel` step type runs multiple branches concurrently using `Promise.allSettled`. Each branch is an independent sequence of steps:

```json
{
  "id": "fetch-all",
  "type": "parallel",
  "merge": "object",
  "branches": [
    {
      "name": "api-data",
      "steps": [
        { "id": "fetch-api", "type": "http-source", "config": { "url": "https://api.example.com/data" } }
      ]
    },
    {
      "name": "metrics",
      "steps": [
        { "id": "fetch-metrics", "type": "http-source", "config": { "url": "https://api.example.com/metrics" } }
      ]
    }
  ]
}
```

**Merge strategies:**

| Strategy | Result |
|----------|--------|
| `object` (default) | Object keyed by branch name: `{ "api-data": ..., "metrics": ... }` |
| `array` | Array of branch results: `[..., ...]` |
| `first` | Result of the first completed branch |

Failed branches are logged and pushed to the dead-letter queue. Successful branches are merged normally.

### Conditional branching

The `branch` step evaluates conditions against the current data and routes to the first matching case:

```json
{
  "id": "route",
  "type": "branch",
  "cases": [
    {
      "name": "high-priority",
      "condition": "data && data.priority > 8",
      "steps": [
        { "id": "alert", "type": "http-sink", "config": { "url": "https://alerts.example.com" } }
      ]
    },
    {
      "name": "normal",
      "condition": "data && data.priority > 3",
      "steps": [
        { "id": "queue", "type": "log", "config": {} }
      ]
    }
  ],
  "default": [
    { "id": "ignore", "type": "log", "config": {} }
  ]
}
```

### Retry and error handling

Each step supports retry with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | 1000ms |
| 2 | 2000ms |
| 3 | 4000ms |
| 4 | Permanent failure |

On permanent failure, the step can:

1. **Continue** (`continueOnError: true`): pass input data to the next step
2. **Fallback**: execute an alternative step definition
3. **Halt**: push to dead-letter queue and throw (default)

### Dead-letter queue

Failed steps are captured in a persistent DLQ with full context:

```json
{
  "step": "fetch-api",
  "type": "http-source",
  "error": "Request timeout after 15000ms",
  "inputData": { "query": "..." },
  "timestamp": "2026-03-05T12:00:00.000Z",
  "attempts": 4
}
```

### Variable interpolation

Pipeline steps can reference variables using `{{placeholder}}` syntax. Variables are set with `set-var` steps or passed in through the pipeline options:

```json
{
  "id": "fetch",
  "type": "http-source",
  "config": {
    "url": "https://api.example.com/data?token={{api_token}}"
  }
}
```

---

## Pipeline format

Pipelines are JSON files stored in the `pipelines/` directory:

```json
{
  "name": "my-pipeline",
  "description": "Fetches data, transforms it, outputs results",
  "steps": [
    {
      "id": "fetch",
      "type": "http-source",
      "config": {
        "url": "https://api.example.com/data",
        "method": "GET",
        "timeout": 15000
      }
    },
    {
      "id": "transform",
      "type": "transform",
      "config": {
        "script": "(data) => ({ processed: true, count: data.length, items: data })"
      }
    },
    {
      "id": "validate",
      "type": "assert",
      "config": {
        "test": "(data) => data.count > 0",
        "message": "No items received"
      }
    },
    {
      "id": "output",
      "type": "file-write",
      "config": {
        "path": "./output/results.json"
      }
    }
  ]
}
```

### Step options

Every step supports these optional fields:

| Field | Type | Description |
|-------|------|-------------|
| `condition` | string | JavaScript expression. Step skips if it evaluates to falsy. |
| `retries` | number | Override default max retries for this step. |
| `config.continueOnError` | boolean | Continue pipeline on failure instead of halting. |
| `config.stopOnNull` | boolean | Stop pipeline if step returns null. |
| `fallback` | object | Alternative step definition to execute on failure. |

---

## Pipeline validation

Validate pipeline definitions before execution:

```sh
npm run validate                          # validates pipelines/default.json
npm run validate -- pipelines/custom.json # validates a specific file
```

The validator checks for:

- Missing `name` field
- Missing or invalid `steps` array
- Missing step `id` or `type`
- Duplicate step IDs
- Unknown step types
- Missing required config (e.g., `url` for `http-source`, `script` for `transform`)
- Missing `branches` for `parallel` steps
- Missing `cases` for `branch` steps

---

## Configuration

All configuration is done via the `.env` file:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_TOKEN` | Yes | -- | Unique token from Synarch launch page |
| `SYNARCH_API_URL` | No | -- | API endpoint URL |
| `AGENT_NAME` | No | unnamed | Display name in the registry |
| `PIPELINE_DIR` | No | `./pipelines` | Directory containing pipeline JSON files |
| `PIPELINE_SCHEDULE` | No | `*/10 * * * *` | Cron expression for pipeline execution |
| `MAX_DEPTH` | No | 50 | Circuit breaker: maximum steps per pipeline run |
| `MAX_RETRIES` | No | 3 | Default retry attempts per step |
| `RETRY_DELAY` | No | 1000 | Initial retry delay in milliseconds |
| `ENABLE_DLQ` | No | true | Enable dead-letter queue for failed steps |
| `HEARTBEAT_INTERVAL` | No | 30 | Heartbeat frequency in seconds |
| `LOG_LEVEL` | No | info | Logging level |

---

## Project structure

```
synarch-orchestrator/
  src/
    index.js              -- Entry point, pipeline loading, startup sequence
    synarch-client.js     -- Network registration, heartbeats, log reporting
    pipeline-engine.js    -- Step execution, parallel, branching, retry, DLQ
    validate-pipeline.js  -- CLI pipeline definition validator
    example-pipeline.js   -- Programmatic pipeline example
    logger.js             -- Structured logging with configurable levels
    self-test.js          -- Connectivity and module integrity verification
  pipelines/
    default.json          -- Simple 3-step example pipeline
    advanced-example.json -- Parallel branches with conditional routing
  package.json
  .env.example
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `axios` | HTTP client for source/sink steps |
| `winston` | Structured logging |
| `dotenv` | Environment variable loading |
| `json-schema` | Pipeline definition validation |

---

## Self-test

Run `npm test` to verify:

- Environment variables are configured
- Network connectivity is available
- Agent token is valid
- Pipeline files parse correctly
- Pipeline engine loads without errors

---

## License

MIT
