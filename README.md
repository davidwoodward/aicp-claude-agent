# aicp-claude-agent

**Claude Conductor Agent (CCA)** --- local CLI wrapper that connects Claude Code to the AICP backend via WebSocket.

## What It Does

CCA runs on your local machine alongside Claude Code. It:

1. Launches Claude Code in a PTY (pseudo-terminal).
2. Opens a persistent WebSocket connection to the AICP backend (`aicp-app`).
3. Authenticates using an API key generated in the AICP web UI.
4. Registers as an agent for a specific project.
5. Receives `execute_prompt` commands from the backend and injects them into Claude Code.
6. Streams Claude Code output back to the backend in real time.
7. Detects execution completion (500ms output inactivity) and reports it.

## Prerequisites

- Node.js 22+
- Claude Code CLI installed and accessible as `claude` in your PATH
- A running AICP backend (`aicp-app`)
- An API key generated from the AICP web UI (Avatar > API Keys)

## Setup

```bash
npm install
npm run dev -- --setup
```

The interactive setup prompts for:

| Step | Description | Saved to |
|------|-------------|----------|
| Backend URL | WebSocket URL (e.g., `ws://localhost:8080/ws`) | `~/.aicp/config.json` |
| Machine name | Label for this agent (defaults to hostname) | `~/.aicp/config.json` |
| API key | Paste from AICP web UI, must start with `aicp_` | `~/.aicp/config.json` |
| Project | Select from list fetched via authenticated API | `.aicp.json` (local dir) |

## Running

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Configuration

### Config Files

| File | Scope | Contains |
|------|-------|----------|
| `~/.aicp/config.json` | Global (all projects) | `backend_url`, `machine_name`, `api_key` |
| `.aicp.json` | Per-directory (project) | `project_id` |

The agent searches up the directory tree for `.aicp.json`, so you can place it at your repo root.

### Environment Variables

Environment variables override config file values:

| Variable | Config file key | Description |
|----------|----------------|-------------|
| `BACKEND_WS_URL` | `backend_url` | WebSocket URL to AICP backend |
| `MACHINE_NAME` | `machine_name` | Agent machine label |
| `AICP_API_KEY` | `api_key` | API key for authentication |
| `PROJECT_ID` | `project_id` | Project to register with |
| `AGENT_ID` | --- | Override agent UUID (auto-generated if not set) |

Create a `.env.local` file for local development:

```
BACKEND_WS_URL=ws://localhost:8080/ws
AICP_API_KEY=aicp_your_key_here
PROJECT_ID=your_project_id
```

## Architecture

```
┌──────────────────────────────────────────────────┐
│  aicp-claude-agent                               │
│                                                  │
│  ┌──────────┐     ┌──────────────┐              │
│  │ index.ts │────>│   main.ts    │              │
│  │ (entry)  │     │ (orchestrator)│              │
│  └──────────┘     └──────┬───────┘              │
│                     │         │                  │
│              ┌──────┴──┐  ┌──┴───────────┐      │
│              │ claude/  │  │  websocket/  │      │
│              │ pty.ts   │  │  client.ts   │      │
│              │ (PTY)    │  │  (WS conn)   │      │
│              └──────────┘  └──────────────┘      │
│                  │                │               │
│           Claude Code        AICP Backend        │
│           (local PTY)       (WebSocket)          │
└──────────────────────────────────────────────────┘
```

### Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point — loads dotenv, routes to `--setup` or `main` |
| `src/main.ts` | Orchestrator — connects PTY output to WS, handles execute commands |
| `src/config.ts` | Config loading — merges env vars, global config, local config |
| `src/setup.ts` | Interactive setup wizard |
| `src/claude/pty.ts` | PTY management — spawn, write, kill Claude Code process |
| `src/websocket/client.ts` | WebSocket client — connect, reconnect, heartbeat, send/receive |
| `src/types/protocol.ts` | Strict TypeScript types for the WS protocol |

## WebSocket Protocol

### Agent -> Backend

| Message | Fields | When |
|---------|--------|------|
| `register` | `agent_id`, `project_id`, `machine_name` | On connect |
| `heartbeat` | --- | Every 10 seconds |
| `status` | `status` (`idle`/`busy`/`offline`) | On state change |
| `message` | `session_id`, `role`, `content`, `timestamp` | During execution |
| `execution_complete` | `prompt_id`, `session_id` | When Claude Code finishes |

### Backend -> Agent

| Message | Fields | When |
|---------|--------|------|
| `registered` | `agent_id` | After successful registration |
| `heartbeat_ack` | --- | In response to heartbeat |
| `execute_prompt` | `prompt_id`, `text` | When user clicks Execute in the UI |
| `error` | `error` | On any server-side error |

## Agent States

| State | Description |
|-------|-------------|
| **idle** | Connected, waiting for work. Only state where prompt injection occurs. |
| **busy** | Executing a prompt. New execute requests are ignored (no queueing). |
| **offline** | Disconnected. Auto-reconnects with exponential backoff (1s to 30s). |

## Part of AICP

This repo is one of three that make up AICP:

| Repo | Purpose |
|------|---------|
| `aicp-app` | Web application (Fastify backend + React frontend) |
| `aicp-infra` | Terraform infrastructure (Cloud Run, Firestore, IAM) |
| **`aicp-claude-agent`** | **This repo** — CLI agent wrapping Claude Code |
