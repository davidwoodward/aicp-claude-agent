import { config } from './config';
import { executePrompt, ExecutionStats, ContextInfo } from './claude/sdk';
import { connect, disconnect, sendMessage, onMessage } from './websocket/client';
import { AgentStatus, BackendToAgentMessage, ExecutePromptMessage } from './types/protocol';
import { printBanner, printStatus, printInfo, printError, createPrompt, writeAbove, updateAbove, wrapText, StyledRL } from './terminal/prompt';
import { startSpinner, stopSpinner, updateSpinnerVerb, clearThinkingVerb, updateSpinnerTokens, isSpinnerActive } from './terminal/spinner';
import { dispatch } from './commands';

// ─── Execution state ────────────────────────────────────────────────

let agentStatus: AgentStatus = 'idle';
let executing = false;
let currentPromptId: string | null = null;
let currentSessionId: string | null = null;
let resumeSessionId: string | undefined;
let shuttingDown = false;
let styledRL: StyledRL | null = null;
let lastContextInfo: ContextInfo | null = null;
let progressBuffer = '';       // buffers partial lines from streaming output
let progressLineActive = false; // true when a partial line is showing via updateAbove

// ─── Helpers ────────────────────────────────────────────────────────

function setStatus(status: AgentStatus): void {
  agentStatus = status;
  sendMessage({ type: 'status', status });
}

function contextSuffix(): string {
  if (lastContextInfo && lastContextInfo.contextWindow > 0) {
    const pct = Math.round((lastContextInfo.inputTokens / lastContextInfo.contextWindow) * 100);
    return `  ·  ${pct}% context`;
  }
  return '';
}

function statusText(): string {
  if (executing) {
    return `esc to interrupt${contextSuffix()}`;
  }
  return `⏵⏵ bypass permissions on${contextSuffix()}`;
}

function syncStatusBar(): void {
  if (styledRL) styledRL.setStatus(statusText());
}

// ─── Execution handler ─────────────────────────────────────────────

async function handleExecutePrompt(msg: ExecutePromptMessage): Promise<void> {
  currentPromptId = msg.prompt_id;
  currentSessionId = msg.session_id;
  executing = true;

  setStatus('busy');
  if (styledRL) styledRL.setStatus('esc to interrupt');

  // Echo user message as plain text in scrollback (always full expanded text)
  for (const ln of msg.text.split('\n')) {
    writeAbove(ln);
  }
  writeAbove('');

  sendMessage({
    type: 'message',
    session_id: msg.session_id,
    role: 'user',
    content: msg.text,
    timestamp: new Date().toISOString(),
  });

  let stats: ExecutionStats | undefined;

  // Start spinner before entering execution loop
  startSpinner();

  try {
    for await (const execMsg of executePrompt(msg.text, {
      cwd: process.cwd(),
      resumeSessionId,
      onProgress: (text) => {
        // Stop spinner before writing assistant text
        stopSpinner();
        // Buffer streaming text, flush complete lines via writeAbove,
        // show partial lines via updateAbove for real-time feedback
        const parts = text.split('\n');
        for (let i = 0; i < parts.length; i++) {
          progressBuffer += parts[i];
          if (i < parts.length - 1) {
            // Got a complete line — finalize it in scrollback
            if (progressLineActive) {
              // Line already exists in scrollback from writeAbove — overwrite with final content
              // If it needs wrapping, flush wrapped continuation lines after
              const wrapped = wrapText(progressBuffer);
              updateAbove(wrapped[0]);
              for (let w = 1; w < wrapped.length; w++) writeAbove(wrapped[w]);
              progressLineActive = false;
            } else {
              writeAbove(progressBuffer);
            }
            progressBuffer = '';
          }
        }
        // Show partial line in-place so user sees streaming text
        if (progressBuffer) {
          if (!progressLineActive) {
            writeAbove(progressBuffer);
            progressLineActive = true;
          } else {
            updateAbove(progressBuffer);
          }
        }
      },
      onContextUpdate: (info) => {
        if (info.contextWindow > 0) {
          lastContextInfo = info;
        } else if (lastContextInfo) {
          lastContextInfo = { ...lastContextInfo, inputTokens: info.inputTokens };
        }
        // Update spinner with token info
        if (lastContextInfo && lastContextInfo.contextWindow > 0) {
          const pct = Math.round((lastContextInfo.inputTokens / lastContextInfo.contextWindow) * 100);
          updateSpinnerTokens(lastContextInfo.inputTokens, pct);
        }
      },
      onToolEvent: (event) => {
        if (event.type === 'tool_start') {
          // Flush any partial progress line before spinner takes over (wrap long lines)
          if (progressBuffer) {
            if (progressLineActive) {
              const wrapped = wrapText(progressBuffer);
              updateAbove(wrapped[0]);
              for (let w = 1; w < wrapped.length; w++) writeAbove(wrapped[w]);
            } else {
              writeAbove(progressBuffer);
            }
            progressBuffer = '';
            progressLineActive = false;
          }
          // Restart spinner with tool verb
          if (!isSpinnerActive()) startSpinner();
          updateSpinnerVerb(event.toolName);
        } else if (event.type === 'tool_end') {
          // Revert to "Thinking" after tool completes
          clearThinkingVerb();
        } else if (event.type === 'tool_progress') {
          updateSpinnerVerb(event.toolName);
        }
      },
    })) {
      if (!currentSessionId) break;

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
    printError(`execution error: ${err}`);
  }

  // Ensure spinner is stopped
  stopSpinner();

  // Flush any remaining partial line from streaming output (wrap long lines)
  if (progressBuffer) {
    if (progressLineActive) {
      const wrapped = wrapText(progressBuffer);
      updateAbove(wrapped[0]);
      for (let w = 1; w < wrapped.length; w++) writeAbove(wrapped[w]);
    } else {
      writeAbove(progressBuffer);
    }
    progressBuffer = '';
    progressLineActive = false;
  }

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

    if (stats) {
      writeAbove('');
      printStatus(`${stats.num_turns} turns | ${stats.input_tokens + stats.output_tokens} tokens | $${stats.cost_usd.toFixed(4)} | ${(stats.duration_ms / 1000).toFixed(1)}s`);
    }
  }

  // Clear resume after first execution — subsequent prompts start fresh
  resumeSessionId = undefined;

  setStatus('idle');
  executing = false;
  currentPromptId = null;
  currentSessionId = null;

  writeAbove('');
  syncStatusBar();
}

// ─── WebSocket message handler ──────────────────────────────────────

onMessage((msg: BackendToAgentMessage) => {
  if (msg.type === 'registered') {
    printInfo(`connected: ${config.backendUrl}`);
    writeAbove('');
    setStatus('idle');
    syncStatusBar();
    return;
  }

  if (msg.type !== 'execute_prompt') return;

  if (executing) {
    printInfo(`ignoring execute_prompt (already executing ${currentPromptId})`);
    return;
  }

  handleExecutePrompt(msg).catch(err => {
    printError(`unhandled execution error: ${err}`);
  });
});

// ─── Stdin input ────────────────────────────────────────────────────

function startStdinInput(): void {
  // SDK always runs with bypass permissions
  styledRL = createPrompt({ statusLine: '⏵⏵ bypass permissions on' });

  // Activate the pinned prompt area at the bottom of the terminal
  styledRL.prompt();

  styledRL.onSubmit(async (input, _displayInput) => {
    const text = input.trim();
    if (!text) {
      syncStatusBar();
      return;
    }

    if (text === 'exit') {
      shutdown(0);
      return;
    }

    if (executing) {
      printInfo('execution in progress, please wait');
      syncStatusBar();
      return;
    }

    // Check for slash commands
    if (text.startsWith('/')) {
      const result = await dispatch(text, styledRL!.rl);
      if (result.resumeSessionId) {
        resumeSessionId = result.resumeSessionId;
        printStatus(`Session loaded — next prompt will resume it`);
      }
      if (result.handled) {
        writeAbove('');
        syncStatusBar();
        return;
      }
    }

    // Regular text — send to backend
    sendMessage({ type: 'local_prompt', text });
  });

  // Double Ctrl-C to exit (like Claude Code)
  let lastCtrlC = 0;
  styledRL.onSigint(() => {
    const now = Date.now();
    if (now - lastCtrlC < 1500) {
      shutdown(0);
      return;
    }
    lastCtrlC = now;
    // Show hint in the status area — no scrolling
    styledRL!.setStatus('Press Ctrl+C again to exit');
    setTimeout(() => {
      if (styledRL && Date.now() - lastCtrlC >= 1400) {
        styledRL.setStatus(statusText());
      }
    }, 1500);
  });

  styledRL.onClose(() => {
    if (!shuttingDown) shutdown(0);
  });
}

// ─── Shutdown ───────────────────────────────────────────────────────

function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;

  stopSpinner();
  writeAbove('');
  printInfo('shutting down...');

  if (styledRL) {
    styledRL.close();
    styledRL = null;
  }

  // Restore terminal state before exit
  if (process.stdin.isTTY) {
    process.stdin.setRawMode?.(false);
  }
  process.stdin.pause();

  disconnect();
  process.exit(exitCode);
}

// SIGTERM from kill — immediate shutdown (no double-press needed)
process.on('SIGTERM', () => shutdown(0));

// ─── Project name fetch ─────────────────────────────────────────────

async function fetchProjectName(): Promise<string | null> {
  try {
    // Derive HTTP base URL from WebSocket URL (ws://host/ws → http://host)
    const wsUrl = new URL(config.backendUrl);
    const httpProto = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
    const baseUrl = `${httpProto}//${wsUrl.host}`;

    const res = await fetch(`${baseUrl}/projects/${config.projectId}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) return null;
    const project = await res.json() as { name?: string };
    return project.name || null;
  } catch {
    return null;
  }
}

// ─── Start ──────────────────────────────────────────────────────────

export async function start(): Promise<void> {
  printBanner();

  const projectName = await fetchProjectName();
  if (projectName) {
    printInfo(`project: ${projectName} (${config.projectId})`);
  } else {
    printInfo(`project: ${config.projectId}`);
  }
  printInfo(`machine: ${config.machineName}`);

  connect();
  startStdinInput();
}
