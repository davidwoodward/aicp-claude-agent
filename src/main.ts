import readline from 'readline';
import { config } from './config';
import { executePrompt, ExecutionStats } from './claude/sdk';
import { connect, disconnect, sendMessage, onMessage } from './websocket/client';
import { AgentStatus, BackendToAgentMessage, ExecutePromptMessage } from './types/protocol';

// ─── Execution state ────────────────────────────────────────────────

let agentStatus: AgentStatus = 'idle';
let executing = false;
let currentPromptId: string | null = null;
let currentSessionId: string | null = null;
let shuttingDown = false;
let rl: readline.Interface | null = null;

// ─── Helpers ────────────────────────────────────────────────────────

function setStatus(status: AgentStatus): void {
  agentStatus = status;
  sendMessage({ type: 'status', status });
}

function showPrompt(): void {
  if (rl && !executing) {
    rl.prompt();
  }
}

// ─── Execution handler ─────────────────────────────────────────────

async function handleExecutePrompt(msg: ExecutePromptMessage): Promise<void> {
  currentPromptId = msg.prompt_id;
  currentSessionId = msg.session_id;
  executing = true;

  setStatus('busy');

  // (a) Show the prompt being executed
  console.log(`\n${'─'.repeat(60)}`);
  console.log(msg.text);
  console.log(`${'─'.repeat(60)}\n`);

  // Send user message to backend
  sendMessage({
    type: 'message',
    session_id: msg.session_id,
    role: 'user',
    content: msg.text,
    timestamp: new Date().toISOString(),
  });

  let stats: ExecutionStats | undefined;

  try {
    for await (const execMsg of executePrompt(msg.text, {
      cwd: process.cwd(),
      // (b) Stream real-time output to terminal
      onProgress: (text) => process.stdout.write(text),
    })) {
      if (!currentSessionId) break;

      // Send clean messages to backend
      sendMessage({
        type: 'message',
        session_id: currentSessionId,
        role: execMsg.role,
        content: execMsg.content,
        timestamp: new Date().toISOString(),
      });

      if (execMsg.stats) {
        stats = execMsg.stats;
      }
    }
  } catch (err) {
    console.error('\n[agent] execution error:', err);
  }

  // Send completion
  if (currentPromptId && currentSessionId) {
    sendMessage({
      type: 'execution_complete',
      prompt_id: currentPromptId,
      session_id: currentSessionId,
      ...(stats && {
        token_usage: {
          input_tokens: stats.input_tokens,
          output_tokens: stats.output_tokens,
        },
        cost_usd: stats.cost_usd,
        num_turns: stats.num_turns,
        duration_ms: stats.duration_ms,
      }),
    });

    // Show stats summary
    if (stats) {
      console.log(`\n[stats] ${stats.num_turns} turns | ${stats.input_tokens + stats.output_tokens} tokens | $${stats.cost_usd.toFixed(4)} | ${(stats.duration_ms / 1000).toFixed(1)}s`);
    }
  }

  setStatus('idle');

  executing = false;
  currentPromptId = null;
  currentSessionId = null;

  // Re-show stdin prompt
  showPrompt();
}

// ─── WebSocket message handler ──────────────────────────────────────

onMessage((msg: BackendToAgentMessage) => {
  if (msg.type === 'registered') {
    setStatus('idle');
    showPrompt();
    return;
  }

  if (msg.type !== 'execute_prompt') return;

  if (executing) {
    console.log(`[agent] ignoring execute_prompt (already executing ${currentPromptId})`);
    return;
  }

  handleExecutePrompt(msg).catch(err => {
    console.error('[agent] unhandled execution error:', err);
  });
});

// ─── Stdin input (c) ───────────────────────────────────────────────

function startStdinInput(): void {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) {
      showPrompt();
      return;
    }

    if (executing) {
      console.log('[agent] execution in progress, please wait');
      showPrompt();
      return;
    }

    // Send to backend — it will create prompt+session and send back execute_prompt
    sendMessage({ type: 'local_prompt', text });
  });

  rl.on('close', () => {
    if (!shuttingDown) shutdown(0);
  });
}

// ─── Shutdown ───────────────────────────────────────────────────────

function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\n[agent] shutting down...');

  if (rl) {
    rl.close();
    rl = null;
  }

  disconnect();
  console.log('[agent] stopped');
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ─── Start ──────────────────────────────────────────────────────────

export function start(): void {
  console.log(`[agent] starting agent=${config.agentId} project=${config.projectId} machine=${config.machineName}`);
  connect();
  startStdinInput();
}
