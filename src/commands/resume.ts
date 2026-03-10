import readline from 'readline';
import { listRecentSessions, SDKSessionInfo } from '../claude/sdk';
import { printStatus, printInfo, printError, printDivider } from '../terminal/prompt';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[38;5;240m';
const WHITE = '\x1b[37m';

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

export async function resumeCommand(rl: readline.Interface): Promise<string | null> {
  printInfo('Loading sessions...');

  let sessions: SDKSessionInfo[];
  try {
    sessions = await listRecentSessions(process.cwd(), 10);
  } catch (err: any) {
    printError(`Failed to list sessions: ${err.message}`);
    return null;
  }

  if (sessions.length === 0) {
    printInfo('No sessions found for this directory.');
    return null;
  }

  printDivider();
  printStatus('Recent Sessions');
  console.log();

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const num = `${BOLD}${WHITE}  ${String(i + 1).padStart(2)}.${RESET}`;
    const title = truncate(s.summary || s.firstPrompt || '(untitled)', 50);
    const time = `${DIM}${GRAY}${timeAgo(s.lastModified)}${RESET}`;
    const branch = s.gitBranch ? `${DIM}${CYAN}[${s.gitBranch}]${RESET}` : '';
    console.log(`${num} ${title}  ${time} ${branch}`);
  }

  console.log();

  return new Promise((resolve) => {
    rl.question(`${DIM}${GRAY}  Pick session (1-${sessions.length}) or Enter to cancel: ${RESET}`, (answer) => {
      const trimmed = answer.trim();
      if (!trimmed) {
        resolve(null);
        return;
      }

      const idx = parseInt(trimmed, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= sessions.length) {
        printError('Invalid selection.');
        resolve(null);
        return;
      }

      const selected = sessions[idx];
      printInfo(`Resuming: ${selected.summary || selected.sessionId}`);
      resolve(selected.sessionId);
    });
  });
}
