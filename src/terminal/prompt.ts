import readline from 'readline';

// ─── ANSI helpers ────────────────────────────────────────────────

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const PINK = '\x1b[38;5;205m';
const GRAY = '\x1b[38;5;240m';
const INFO = '\x1b[38;5;245m';
const WHITE = '\x1b[37m';
const CYAN = '\x1b[36m';

const LINE_CHAR = '─';
const PROMPT_CHAR = '❯';
const CONT_PREFIX = '  ';
const PROMPT_VISUAL_LEN = 2; // "❯ " = 2 visible chars

// ─── Terminal width ──────────────────────────────────────────────

function termWidth(): number {
  return process.stdout.columns || 80;
}

function hrLine(): string {
  return `${DIM}${GRAY}${LINE_CHAR.repeat(termWidth())}${RESET}`;
}

// ─── Public API ──────────────────────────────────────────────────

export function printBanner(): void {
  console.log(hrLine());
  console.log(`${BOLD}${CYAN}  AICP Agent${RESET}`);
  console.log(hrLine());
  console.log();
}

export function printStatus(text: string): void {
  console.log(`${PINK}  ${text}${RESET}`);
}

export function printInfo(text: string): void {
  console.log(`${INFO}  ${text}${RESET}`);
}

export function printError(text: string): void {
  console.log(`\x1b[31m  ${text}${RESET}`);
}

export function printDivider(): void {
  console.log(hrLine());
}

function promptString(): string {
  return `${BOLD}${WHITE}${PROMPT_CHAR}${RESET} `;
}

// ─── User message echo ──────────────────────────────────────────

const BG_DARK = '\x1b[48;5;235m';

export function printUserMessage(text: string): void {
  const width = termWidth();
  const lines = text.split('\n');

  console.log();
  for (let i = 0; i < lines.length; i++) {
    const prefix = i === 0 ? `${BOLD}${WHITE}${PROMPT_CHAR}${RESET} ` : '  ';
    const prefixVisible = i === 0 ? PROMPT_VISUAL_LEN : 2;
    const content = lines[i];
    const pad = Math.max(0, width - prefixVisible - content.length);
    console.log(`${BG_DARK}${prefix}${content}${' '.repeat(pad)}${RESET}`);
  }
  console.log();
}

// ─── Status bar formatting ──────────────────────────────────────

export function formatStatusBar(left: string, right: string): string {
  const width = termWidth();
  const gap = Math.max(1, width - left.length - right.length);
  return `${PINK}  ${left}${' '.repeat(gap)}${right}  ${RESET}`;
}

// ─── Styled prompt with multiline support ────────────────────────

export interface PromptOptions {
  statusLine?: string;
}

export interface StyledRL {
  rl: readline.Interface;
  onSubmit(handler: (input: string) => void): void;
  onClose(handler: () => void): void;
  onSigint(handler: () => void): void;
  setStatus(text: string): void;
  updateStatus(text: string): void;
  prompt(): void;
  close(): void;
}

export function createPrompt(opts?: PromptOptions): StyledRL {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: promptString(),
  });

  const buffer: string[] = [];
  let submitHandler: ((input: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let sigintHandler: (() => void) | null = null;
  let currentStatus = opts?.statusLine || '';
  const hasStatus = !!opts?.statusLine;
  const belowCount = 1 + (hasStatus ? 1 : 0); // bottom bar + optional status

  // ── Render bottom bar + status below cursor, move back ──

  function renderBelow(): void {
    // Write lines below the current cursor position
    process.stdout.write('\n\x1b[2K' + hrLine());
    if (hasStatus) {
      process.stdout.write('\n\x1b[2K' + `${PINK}  ${currentStatus}${RESET}`);
    }
    process.stdout.write('\x1b[J'); // clear any leftover content below
    // Move back up to the input line, restore column after prompt
    process.stdout.write(`\x1b[${belowCount}A\x1b[${PROMPT_VISUAL_LEN + 1}G`);
  }

  // ── Update status line in-place without scrolling ──

  function updateStatusInPlace(text: string): void {
    if (!hasStatus) return;
    currentStatus = text;
    const col = ((rl as any).cursor || 0) + PROMPT_VISUAL_LEN + 1;
    // Move down to status line, clear and rewrite, move back up
    process.stdout.write(`\x1b[${belowCount}B`);
    process.stdout.write(`\r\x1b[2K${PINK}  ${text}${RESET}`);
    process.stdout.write(`\x1b[${belowCount}A\x1b[${col}G`);
  }

  // ── Intercept keypresses ──

  const origTtyWrite = (rl as any)._ttyWrite.bind(rl);
  (rl as any)._ttyWrite = function (s: string, key: any) {
    // Ctrl+C — handle ourselves so readline doesn't touch the display
    if (key && key.ctrl && key.name === 'c') {
      if (sigintHandler) sigintHandler();
      return;
    }

    // Shift+Enter — multiline continuation
    if (key && key.name === 'return' && key.shift) {
      buffer.push((rl as any).line);
      (rl as any).line = '';
      (rl as any).cursor = 0;
      process.stdout.write('\n');
      rl.setPrompt(CONT_PREFIX);
      rl.prompt();
      renderBelow();
      return;
    }

    origTtyWrite(s, key);
  };

  // ── Normal Enter comes through as a 'line' event ──

  rl.on('line', (inputLine) => {
    // Cursor is now on the line below input (where bottom bar was pre-rendered).
    // Clear pre-rendered content from here down.
    process.stdout.write('\x1b[2K\x1b[J');

    if (inputLine.endsWith('\\')) {
      // Backslash continuation — accumulate, show continuation prompt
      buffer.push(inputLine.slice(0, -1));
      rl.setPrompt(CONT_PREFIX);
      rl.prompt();
      renderBelow();
      return;
    }

    // Final line — clear pre-rendered chrome, submit
    buffer.push(inputLine);
    const fullInput = buffer.join('\n');
    buffer.length = 0;
    rl.setPrompt(promptString());

    if (submitHandler) submitHandler(fullInput);
  });

  rl.on('close', () => {
    if (closeHandler) closeHandler();
  });

  return {
    rl,
    onSubmit(handler) { submitHandler = handler; },
    onClose(handler) { closeHandler = handler; },
    onSigint(handler) { sigintHandler = handler; },
    setStatus(text: string) { updateStatusInPlace(text); },
    updateStatus(text: string) { currentStatus = text; },
    prompt() {
      console.log(hrLine());
      rl.setPrompt(promptString());
      rl.prompt();
      renderBelow();
    },
    close() {
      rl.close();
    },
  };
}
