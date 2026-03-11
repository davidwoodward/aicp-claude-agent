import { resumeCommand } from './resume';
import { printInfo, writeAbove } from '../terminal/prompt';

export interface CommandResult {
  handled: boolean;
  resumeSessionId?: string;
}

const COMMANDS: Record<string, string> = {
  '/resume': 'Resume a previous Claude session',
  '/help': 'Show available commands',
};

function helpCommand(): void {
  printInfo('Available commands:');
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    writeAbove(`  \x1b[1m\x1b[37m${cmd.padEnd(12)}\x1b[0m \x1b[2m\x1b[38;5;240m${desc}\x1b[0m`);
  }
}

interface Questionable {
  question(prompt: string, cb: (answer: string) => void): void;
}

export async function dispatch(input: string, rl: Questionable): Promise<CommandResult> {
  const cmd = input.toLowerCase().trim();

  if (cmd === '/help') {
    helpCommand();
    return { handled: true };
  }

  if (cmd === '/resume') {
    const sessionId = await resumeCommand(rl);
    return { handled: true, resumeSessionId: sessionId || undefined };
  }

  if (cmd.startsWith('/')) {
    printInfo(`Unknown command: ${cmd}. Type /help for available commands.`);
    return { handled: true };
  }

  return { handled: false };
}
