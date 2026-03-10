// ─── Animated execution spinner ─────────────────────────────────
//
// Renders a single updating line during execution:
//   ⠹ Reading... (3s · ↓ 1.2k tokens)
//

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

// AICP palette
const TEAL = '\x1b[38;5;80m';
const NEAR_WHITE = '\x1b[38;5;253m';
const DIM_GRAY = '\x1b[38;5;242m';
const RESET = '\x1b[0m';

// ─── Tool verb map ──────────────────────────────────────────────

const TOOL_VERBS: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  Bash: 'Executing',
  Glob: 'Searching',
  Grep: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching',
  Agent: 'Running agent',
};

function verbForTool(toolName: string): string {
  return TOOL_VERBS[toolName] || 'Thinking';
}

// ─── State ──────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let frameIdx = 0;
let verb = 'Thinking';
let startTime = 0;
let inputTokens = 0;
let contextPct = 0;
let lineVisible = false;

// ─── Rendering ──────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function render(): void {
  const frame = FRAMES[frameIdx % FRAMES.length];
  frameIdx++;

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const elapsedStr = `${elapsed}s`;

  let meta = elapsedStr;
  if (inputTokens > 0) {
    meta += ` · ↓ ${formatTokens(inputTokens)} tokens`;
  }
  if (contextPct > 0) {
    meta += ` · ${contextPct}%`;
  }

  const line = `${TEAL}${frame}${RESET} ${NEAR_WHITE}${verb}...${RESET} ${DIM_GRAY}(${meta})${RESET}`;
  process.stdout.write(`\r\x1b[2K${line}`);
  lineVisible = true;
}

// ─── Public API ─────────────────────────────────────────────────

export function startSpinner(): void {
  if (timer) return;
  frameIdx = 0;
  verb = 'Thinking';
  startTime = Date.now();
  inputTokens = 0;
  contextPct = 0;
  timer = setInterval(render, FRAME_MS);
  render();
}

export function stopSpinner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (lineVisible) {
    process.stdout.write('\r\x1b[2K');
    lineVisible = false;
  }
}

export function updateSpinnerVerb(toolName: string): void {
  verb = verbForTool(toolName);
}

export function clearThinkingVerb(): void {
  verb = 'Thinking';
}

export function updateSpinnerTokens(tokens: number, pct: number): void {
  inputTokens = tokens;
  contextPct = pct;
}

export function isSpinnerActive(): boolean {
  return timer !== null;
}
