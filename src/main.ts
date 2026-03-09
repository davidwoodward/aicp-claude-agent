import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { startClaude, stopClaude, sendToClaude, onClaudeOutput, onClaudeExit } from './claude/pty';
import { connect, disconnect, sendMessage, onMessage } from './websocket/client';
import { AgentStatus, BackendToAgentMessage } from './types/protocol';

// ─── Execution state ────────────────────────────────────────────────

const INACTIVITY_TIMEOUT = 500;

let agentStatus: AgentStatus = 'idle';
let executing = false;
let currentPromptId: string | null = null;
let currentSessionId: string | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;

// ─── PTY output handler ─────────────────────────────────────────────

onClaudeOutput((data: string) => {
  if (!executing || !currentSessionId) return;

  sendMessage({
    type: 'message',
    session_id: currentSessionId,
    role: 'claude',
    content: data,
    timestamp: new Date().toISOString(),
  });

  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    completeExecution();
  }, INACTIVITY_TIMEOUT);
});

onClaudeExit((exitCode: number) => {
  console.log(`[pty] claude exited code=${exitCode}`);
  if (!shuttingDown) {
    shutdown(exitCode);
  }
});

// ─── WebSocket message handler ──────────────────────────────────────

function setStatus(status: AgentStatus): void {
  agentStatus = status;
  sendMessage({ type: 'status', status });
}

onMessage((msg: BackendToAgentMessage) => {
  if (msg.type === 'registered') {
    setStatus('idle');
    return;
  }

  if (msg.type !== 'execute_prompt') return;
  if (executing) {
    console.log(`[agent] ignoring execute_prompt (already executing ${currentPromptId})`);
    return;
  }

  currentPromptId = msg.prompt_id;
  currentSessionId = uuidv4();
  executing = true;

  setStatus('busy');

  sendMessage({
    type: 'message',
    session_id: currentSessionId,
    role: 'user',
    content: msg.text,
    timestamp: new Date().toISOString(),
  });

  sendToClaude(msg.text + '\n');
});

// ─── Execution completion ───────────────────────────────────────────

function completeExecution(): void {
  if (!executing || !currentPromptId || !currentSessionId) return;

  sendMessage({
    type: 'execution_complete',
    prompt_id: currentPromptId,
    session_id: currentSessionId,
  });

  setStatus('idle');

  console.log(`[agent] execution complete: prompt=${currentPromptId} session=${currentSessionId}`);

  executing = false;
  currentPromptId = null;
  currentSessionId = null;
  inactivityTimer = null;
}

// ─── Shutdown ───────────────────────────────────────────────────────

function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('[agent] shutting down...');

  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode?.(false);
  }
  process.stdin.pause();

  disconnect();
  stopClaude();

  console.log('[agent] stopped');
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ─── Start ──────────────────────────────────────────────────────────

export function start(): void {
  console.log(`[agent] starting agent=${config.agentId} project=${config.projectId} machine=${config.machineName}`);
  startClaude();
  connect();
}
