import * as pty from 'node-pty';
import { IPty } from 'node-pty';

type OutputCallback = (data: string) => void;
type ExitCallback = (exitCode: number) => void;

let claudeProcess: IPty | null = null;
const outputCallbacks: OutputCallback[] = [];
let exitCallback: ExitCallback | null = null;

export function startClaude(): void {
  if (claudeProcess) {
    throw new Error('Claude process already running');
  }

  claudeProcess = pty.spawn('claude', [], {
    name: 'xterm-256color',
    cols: process.stdout.columns || 120,
    rows: process.stdout.rows || 40,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  });

  claudeProcess.onData((data: string) => {
    process.stdout.write(data);
    for (const cb of outputCallbacks) {
      cb(data);
    }
  });

  claudeProcess.onExit(({ exitCode }) => {
    claudeProcess = null;
    if (exitCallback) {
      exitCallback(exitCode);
    }
  });

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on('data', (data: Buffer) => {
    claudeProcess?.write(data.toString());
  });

  process.stdout.on('resize', () => {
    claudeProcess?.resize(
      process.stdout.columns || 120,
      process.stdout.rows || 40,
    );
  });
}

export function stopClaude(): void {
  if (!claudeProcess) return;
  claudeProcess.kill();
  claudeProcess = null;
}

export function sendToClaude(text: string): void {
  if (!claudeProcess) {
    throw new Error('Claude process not running');
  }
  claudeProcess.write(text);
}

export function onClaudeOutput(callback: OutputCallback): void {
  outputCallbacks.push(callback);
}

export function onClaudeExit(callback: ExitCallback): void {
  exitCallback = callback;
}
