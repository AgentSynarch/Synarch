# SYNARCH

One main agent. Infinite forks. Autonomous infrastructure at scale.

---

**Deploy infrastructure, not agents.**

Synarch is a framework for deploying and managing hierarchical AI agent networks. Fork a pre-built agent, bake your token into `.env`, and run it. The agent registers itself, sends heartbeats, reports logs, and tracks metrics -- all automatically.

Three agent types. Each one is a standalone Node.js process you clone, configure, and run anywhere.

|  | Step | What happens |
|---|---|---|
| **01** | Pick an agent type | Worker, Analyzer, or Orchestrator. Each solves a different class of problem. |
| **02** | Get your token | One-click registration on [synarch.app/launch](https://synarch.app/launch). Token is generated instantly. |
| **03** | Clone and run | One terminal command. The agent activates on first heartbeat. |

---

## Agent types

### Worker

Task automation with production-grade reliability. Cron-scheduled jobs, API polling, file watching, and health checks.

- Topological dependency ordering between tasks
- Exponential backoff retry with configurable limits
- Circuit breaker pattern -- blocks tasks after 5 consecutive failures, auto-recovers after 60s
- Per-task metrics: success rate, duration, P95 latency, memory usage
- Event emitter architecture for monitoring hooks
- Concurrency control and timeout enforcement
- Colored structured logging with elapsed time tracking
- Graceful shutdown with session summaries

```js
// Drop a file in src/tasks/ and it runs
module.exports = {
  name: "my-task",
  priority: 5,
  dependsOn: ["health-check"],
  condition: async (results) => results.get("health-check")?.status === "success",
  run: async (logger, client, ctx) => {
    logger.info("Processing data", { attempt: ctx.attempt });
    return { data: await fetchSomething() };
  },
  onError: async (err, logger) => logger.error(err.message),
};
```

[Full Worker documentation](docs/README-worker.md)

### Analyzer

AST-powered code intelligence. Parses JavaScript and JSX with Acorn, walks the syntax tree, and generates structured reports.

- Cyclomatic complexity per function (decision point counting, not line counting)
- 18 security patterns: eval, innerHTML, hardcoded secrets, prototype pollution, SSL bypass, command injection
- Unused variable and duplicate code detection
- Code smell identification: throw-literal, empty catches, loose equality, console/debugger statements
- Report output in JSON, Markdown, or standalone dark-themed HTML
- Regex fallback for files that fail AST parsing
- AST parse success/failure tracking in results

```
Analysis pipeline:
  Glob files -> Parse AST -> Run analyzers -> Filter by severity -> Generate report
```

| Security pattern | Severity | Risk |
|-----------------|----------|------|
| `eval()` | Critical | Arbitrary code execution |
| `innerHTML =` | Critical | Cross-site scripting |
| Hardcoded passwords/keys/tokens | Critical | Credential exposure |
| `__proto__` access | Critical | Prototype pollution |
| Template literal in `exec()` | Critical | Command injection |
| SSL verification disabled | Critical | Man-in-the-middle |
| `new Function()` | Warning | Dynamic code execution |
| `dangerouslySetInnerHTML` | Warning | React XSS vector |
| `Math.random()` | Info | Not cryptographically secure |

[Full Analyzer documentation](docs/README-analyzer.md)

### Orchestrator

JSON-driven data pipelines with parallel execution, conditional branching, and dead-letter queues.

- 18 built-in step types: http-source, http-sink, transform, filter, map, reduce, flatten, delay, log, set-var, file-read, file-write, assert, parallel, branch, batch, dedupe, sort
- Parallel branches with merge strategies (object, array, first)
- Conditional routing with case matching and default fallback
- Variable interpolation with `{{placeholder}}` syntax
- HTTP rate limiting to avoid upstream throttling
- Batch processing with configurable chunk sizes and inter-batch delays
- Pipeline validation CLI catches errors before runtime
- Dead-letter queue captures failed steps with full context for replay
- Per-step metrics with duration and attempt tracking

```json
{
  "name": "fetch-and-process",
  "steps": [
    { "id": "fetch", "type": "http-source", "config": { "url": "https://api.example.com/data" } },
    { "id": "transform", "type": "transform", "config": { "script": "(data) => data.filter(x => x.active)" } },
    { "id": "dedupe", "type": "dedupe", "config": { "key": "id" } },
    { "id": "sort", "type": "sort", "config": { "key": "priority", "order": "desc" } },
    { "id": "output", "type": "file-write", "config": { "path": "./output/results.json" } }
  ]
}
```

[Full Orchestrator documentation](docs/README-orchestrator.md)

---

## Quickstart

### From the dashboard

1. Go to [synarch.app/launch](https://synarch.app/launch) and pick an agent type
2. Copy the generated terminal command
3. Paste and run

### Using the CLI

```sh
cd cli && npm install && npm link
synarch deploy worker --name my-poller
# Follow the printed instructions to clone and activate
```

### Manual setup

```sh
git clone https://github.com/AgentSynarch/synarch-worker.git
cd synarch-worker
npm install
echo "AGENT_TOKEN=<your-token>" > .env
npm test    # verify connectivity and token
npm start   # activate agent
```

The agent registers with the network on startup. Status transitions from `pending` to `active` on first heartbeat.

> **Requirements:** Node.js 18+, npm

---

## CLI

The Synarch CLI lets you deploy, monitor, and manage agents from the terminal without touching the dashboard.

```sh
synarch status                         # list all agents
synarch deploy worker --name my-agent  # register a new agent
synarch logs <agent-id> --limit 100    # view agent logs
synarch watch --interval 3             # live-tail activity
synarch health                         # check API connectivity
synarch export <id> --format csv       # export logs
synarch init analyzer                  # generate starter .env
```

[Full CLI documentation](cli/README.md)

---

## How agents work

### Lifecycle

```
Clone repo -> Configure .env -> npm start
  |
  |-- Agent reads AGENT_TOKEN
  |-- Sends registration heartbeat
  |-- Status: pending -> active
  |-- Begins work (tasks / analysis / pipeline)
  |-- Periodic heartbeats maintain active status
  |-- Logs batched and flushed to network every 10s
  |-- Metrics reported at configurable intervals
  |-- On shutdown: status -> offline, session summary logged
```

### Heartbeat protocol

Every agent sends periodic heartbeats to the Synarch network. The heartbeat interval is configurable (default: 30 seconds). If an agent stops sending heartbeats, the network detects it as offline.

Heartbeat failures are tracked. After 5 consecutive failures, the agent logs a network-down warning but continues operating locally.

### Circuit breaker (Worker)

The Worker agent implements a circuit breaker pattern per task. If a task fails 5 times consecutively, it is blocked for 60 seconds. After the cooldown, the circuit closes and the task resumes. This prevents a single broken task from consuming all retry budget.

### Log batching

All agents batch log entries and flush them to the network every 10 seconds, sending up to 50 entries per flush. This reduces network overhead while maintaining near-real-time visibility.

### Self-test

Every agent ships with `npm test` that verifies:

- Environment variables are present and valid
- Node.js version meets minimum requirements
- Network connectivity to the Synarch API
- Agent token is recognized
- All modules load without errors
- Results displayed in a formatted table

Run this before deploying to catch configuration issues early.

---

## API reference

All agents communicate through a central REST API. You do not need to call this directly -- agents handle it automatically. Documented here for advanced use cases and custom integrations.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/register` | Register a new agent. Returns agent ID and fork name. |
| `POST` | `/heartbeat` | Update agent status (`active`, `idle`, `offline`). |
| `POST` | `/log` | Persist a log entry for an agent. |
| `GET` | `/agents` | List all registered agents (max 100). |
| `GET` | `/stats` | Network statistics: total forks, active count, logs, breakdown by type. |
| `GET` | `/logs` | Query logs by agent. Params: `agent_id`, `limit` (max 200). |

### Register

```sh
curl -X POST https://your-api-url/register \
  -H "Content-Type: application/json" \
  -d '{
    "agent_type": "worker",
    "agent_name": "my-poller",
    "github_username": "your-username",
    "config": {
      "log_level": "info",
      "max_retries": 3,
      "auto_restart": true
    }
  }'
```

### Heartbeat

```sh
curl -X POST https://your-api-url/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "uuid-here", "status": "active"}'
```

### Query logs

```sh
curl "https://your-api-url/logs?agent_id=uuid-here&limit=50"
```

---

## Agent repos

Each agent type has its own repository for independent forking and deployment:

| Agent | Repository | Description |
|-------|-----------|-------------|
| Worker | [synarch-worker](https://github.com/AgentSynarch/synarch-worker) | Scheduled task automation with circuit breakers |
| Analyzer | [synarch-analyzer](https://github.com/AgentSynarch/synarch-analyzer) | AST-powered code analysis and security scanning |
| Orchestrator | [synarch-orchestrator](https://github.com/AgentSynarch/synarch-orchestrator) | JSON-driven data pipelines with parallel execution |

---

## Configuration reference

Environment variables common to all agent types:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_TOKEN` | Yes | -- | Unique token from the Synarch launch page |
| `SYNARCH_API_URL` | No | -- | API endpoint URL |
| `AGENT_NAME` | No | unnamed | Display name in the network registry |
| `GITHUB_USERNAME` | No | -- | Associated GitHub account |
| `HEARTBEAT_INTERVAL` | No | 30 | Heartbeat frequency in seconds |
| `LOG_LEVEL` | No | info | Logging level: debug, info, warn, error |
| `AUTO_RESTART` | No | false | Restart on uncaught exceptions |
| `MAX_RETRIES` | No | 3 | Retry attempts for failed operations |
| `RETRY_DELAY` | No | 1000 | Initial retry delay in milliseconds |

Agent-specific variables are documented in each agent's README.

---

## Community

- [X (Twitter)](https://x.com/AgentSynarch) -- Updates and announcements
- [GitHub Issues](https://github.com/AgentSynarch/synarch/issues) -- Bugs and feature requests

## License

MIT
