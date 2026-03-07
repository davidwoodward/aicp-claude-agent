## Project Overview

This is the **aicp-claude-agent** — a Node.js/TypeScript CLI tool that wraps Claude Code and connects it to the AICP backend via WebSocket. It acts as a bridge: receiving prompt execution commands from the web UI and injecting them into a local Claude Code PTY session.

## Tech Stack

- **Runtime**: Node.js 22 + TypeScript
- **PTY**: node-pty (spawns Claude Code in a pseudo-terminal)
- **WebSocket**: ws (persistent connection to aicp-app backend)
- **Config**: dotenv + JSON config files

## Project Structure

```
src/
├── index.ts           # Entry point — dotenv, routes --setup vs main
├── main.ts            # Orchestrator — PTY↔WS bridge, execution lifecycle
├── config.ts          # Config loading — env vars > global config > local config
├── setup.ts           # Interactive setup wizard (--setup flag)
├── claude/
│   └── pty.ts         # PTY management — spawn, write, kill Claude Code
├── websocket/
│   └── client.ts      # WebSocket client — connect, reconnect, heartbeat
└── types/
    └── protocol.ts    # Strict WS protocol types (agent↔backend contract)
```

## AICP Product

This repo is one of three that make up the AICP product:

| Repo | Purpose |
|---|---|
| `aicp-app` | Web application (Fastify backend + React frontend) |
| `aicp-infra` | Terraform infrastructure (Cloud Run, Firestore, IAM) |
| **`aicp-claude-agent`** | **This repo** — CLI agent wrapping Claude Code |

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Run with ts-node
npm run dev -- --setup  # Run interactive setup
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output
```

## Configuration

### Precedence (highest wins)

1. Environment variables (`.env.local` or shell)
2. Global config (`~/.aicp/config.json`)
3. Local config (`.aicp.json` — searched up directory tree)

### Environment Variables

| Variable | Description |
|----------|-------------|
| `BACKEND_WS_URL` | WebSocket URL to AICP backend |
| `MACHINE_NAME` | Agent machine label (defaults to hostname) |
| `AICP_API_KEY` | API key for authentication (required) |
| `PROJECT_ID` | Firestore project ID to register with (required) |
| `AGENT_ID` | Override agent UUID (auto-generated if not set) |

### Config Files

- **`~/.aicp/config.json`** — global: `{ backend_url, machine_name, api_key }`
- **`.aicp.json`** — per-directory: `{ project_id }`

## Conventions

- Config validation happens in `loadConfig()` — fails fast with actionable error messages
- The `config` export uses a lazy proxy to avoid validation during `--setup`
- `setup.ts` imports only read/write helpers from `config.ts`, never the `config` singleton
- The WebSocket client handles reconnection with exponential backoff (1s to 30s max)
- Heartbeats are sent every 10 seconds to keep the connection alive
- Execution completion is detected by output inactivity (500ms timeout)
- Only one execution at a time — concurrent execute requests are ignored (no queue)

## WebSocket Protocol

The protocol is defined in `src/types/protocol.ts`. It is a strict contract shared with the `aicp-app` backend.

**Authentication:** The API key is sent as a `?token=` query parameter on the WebSocket URL. The backend validates it before allowing the connection.

**Registration flow:** On connect → send `register` with `agent_id`, `project_id`, `machine_name` → receive `registered` → set status to `idle`.

**Execution flow:** Receive `execute_prompt` → set status to `busy` → write prompt to PTY → stream `message` events back → detect inactivity → send `execution_complete` → set status to `idle`.
