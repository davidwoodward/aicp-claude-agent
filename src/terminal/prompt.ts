import { addHistory, historyLength, getHistoryDisplay } from '../history';

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
const BASE_PROMPT_LINES = 4; // top divider, input, bottom divider, status
const PASTE_FOLD_THRESHOLD = 4; // fold pasted blocks with this many or more lines

// ─── Terminal dimensions ────────────────────────────────────────

function termWidth(): number {
  return process.stdout.columns || 80;
}

function termHeight(): number {
  return process.stdout.rows || 24;
}

function hrLine(): string {
  return `\x1b[38;5;60m${LINE_CHAR.repeat(termWidth())}${RESET}`;
}

// ─── Pinned prompt state ────────────────────────────────────────

let promptActive = false;
let currentStatus = '';
let extraLines = 0; // number of continuation lines (grows the prompt area)

function promptHeight(): number {
  return BASE_PROMPT_LINES + extraLines;
}

// ─── writeAbove — insert text into scrollback above the prompt ──

export function writeAbove(text: string): void {
  const wrapped = wrapText(text);
  if (!promptActive) {
    for (const wl of wrapped) process.stdout.write(wl + '\n');
    return;
  }

  const rows = termHeight();
  const scrollBottom = rows - promptHeight();

  for (const wl of wrapped) {
    process.stdout.write(
      '\x1b[s' +
      `\x1b[1;${scrollBottom}r` +
      `\x1b[${scrollBottom};1H` +
      '\n' +
      `\x1b[${scrollBottom};1H` +
      '\x1b[2K' +
      wl +
      `\x1b[1;${rows}r` +
      '\x1b[u'
    );
  }
}

// ─── updateAbove — overwrite the last scrollback line in-place ───

export function updateAbove(text: string): void {
  // Only show what fits on one line — truncate the rest.
  // Full wrapping happens when the line is finalized via writeAbove.
  if (visibleLength(text) > termWidth()) {
    const wrapped = wrapText(text);
    text = wrapped[0];
  }

  if (!promptActive) {
    process.stdout.write(`\r\x1b[2K${text}`);
    return;
  }

  const rows = termHeight();
  const scrollBottom = rows - promptHeight();

  process.stdout.write(
    '\x1b[s' +
    `\x1b[${scrollBottom};1H` +
    '\x1b[2K' +
    text +
    '\x1b[u'
  );
}

// ─── clearAbove — clear the last scrollback line ────────────────

export function clearAbove(): void {
  if (!promptActive) {
    process.stdout.write('\r\x1b[2K');
    return;
  }

  const rows = termHeight();
  const scrollBottom = rows - promptHeight();

  process.stdout.write(
    '\x1b[s' +
    `\x1b[${scrollBottom};1H` +
    '\x1b[2K' +
    '\x1b[u'
  );
}

// ─── Public print helpers (route through writeAbove) ────────────

export function printBanner(): void {
  writeAbove(hrLine());
  writeAbove(`${BOLD}${CYAN}  AICP Agent${RESET}`);
  writeAbove(hrLine());
  writeAbove('');
}

export function printStatus(text: string): void {
  writeAbove(`${PINK}  ${text}${RESET}`);
}

export function printInfo(text: string): void {
  writeAbove(`${INFO}  ${text}${RESET}`);
}

export function printError(text: string): void {
  writeAbove(`\x1b[31m  ${text}${RESET}`);
}

export function printDivider(): void {
  writeAbove(hrLine());
}

// ─── Word wrap helper ───────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLength(str: string): number {
  return str.replace(ANSI_RE, '').length;
}

export function wrapText(text: string): string[] {
  const width = termWidth();
  if (visibleLength(text) <= width) return [text];

  // Walk the string tracking visible character count
  const result: string[] = [];
  let remaining = text;

  while (visibleLength(remaining) > width) {
    // Find the byte index where visible chars reach width
    let visCount = 0;
    let cutIdx = 0;
    let lastSpace = -1;
    for (let i = 0; i < remaining.length; i++) {
      // Skip ANSI sequences
      if (remaining[i] === '\x1b' && remaining[i + 1] === '[') {
        let j = i + 2;
        while (j < remaining.length && ((remaining[j] >= '0' && remaining[j] <= '9') || remaining[j] === ';')) j++;
        if (j < remaining.length && remaining[j] === 'm') {
          i = j; // skip to end of sequence (loop will i++)
          continue;
        }
      }
      if (remaining[i] === ' ') lastSpace = i;
      visCount++;
      if (visCount >= width) {
        cutIdx = i + 1;
        break;
      }
    }

    // Prefer breaking at a space
    let breakAt = (lastSpace > 0) ? lastSpace : cutIdx;
    result.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^ /, '');
  }
  if (remaining) result.push(remaining);
  return result;
}

// ─── Paste placeholder styling ──────────────────────────────────

export function stylePastePlaceholders(text: string): string {
  return text.replace(/\[Pasted text #\d+ \+\d+ lines?\]/g,
    match => `\x1b[38;5;117m${match}${RESET}`);
}

// ─── Status bar formatting ──────────────────────────────────────

export function formatStatusBar(left: string, right: string): string {
  const width = termWidth();
  const gap = Math.max(1, width - left.length - right.length);
  return `${PINK}  ${left}${' '.repeat(gap)}${right}  ${RESET}`;
}

// ─── Styled prompt — raw stdin, no readline ─────────────────────

export interface PromptOptions {
  statusLine?: string;
}

export interface StyledRL {
  rl: { question: (prompt: string, cb: (answer: string) => void) => void };
  onSubmit(handler: (input: string, displayInput: string) => void): void;
  onClose(handler: () => void): void;
  onSigint(handler: () => void): void;
  setStatus(text: string): void;
  updateStatus(text: string): void;
  writeAbove(text: string): void;
  prompt(): void;
  close(): void;
}

export function createPrompt(opts?: PromptOptions): StyledRL {
  let submitHandler: ((input: string, displayInput: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let sigintHandler: (() => void) | null = null;
  currentStatus = opts?.statusLine || '';

  // ── Input state ──
  let line = '';           // current active line being edited
  let cursor = 0;         // cursor position within active line
  const lines: string[] = []; // previous continuation lines
  let activeLineIdx = 0;  // which line is being edited (lines.length = current input)
  let closed = false;
  let pasting = false;    // true between bracketed paste start/end sequences

  // ── Paste folding state ──
  let pasteBuffering = false; // true while buffering paste content
  let pasteBuffer = '';       // accumulates raw paste content
  const pasteBlocks: { id: number; content: string }[] = [];
  let pasteCounter = 0;      // sequential paste block numbering, resets on submit

  // ── History navigation state ──
  let historyIndex = -1;      // -1 = current input, 0..N-1 = history (0=oldest)
  let savedInput = '';        // stash current input when browsing history

  // For rl.question() compatibility
  let questionCb: ((answer: string) => void) | null = null;
  let questionPromptText = '';

  // ── Drawing helpers ──

  function currentPromptStr(): string {
    if (questionCb) return questionPromptText;
    return `${BOLD}${WHITE}${PROMPT_CHAR}${RESET} `;
  }

  function promptVisualLen(): number {
    if (questionCb) return questionPromptText.replace(/\x1b\[[0-9;]*m/g, '').length;
    return 2; // "❯ "
  }

  // Get all editable lines as a flat array (line inserted at activeLineIdx)
  function allLines(): string[] {
    const result = [...lines];
    result.splice(activeLineIdx, 0, line);
    return result;
  }

  // Switch editing focus to a different line
  function switchToLine(newIdx: number): void {
    const all = allLines();
    activeLineIdx = newIdx;
    line = all[newIdx];
    cursor = Math.min(cursor, line.length);
    lines.length = 0;
    for (let i = 0; i < all.length; i++) {
      if (i !== newIdx) lines.push(all[i]);
    }
  }

  // Load text into the prompt (for history navigation)
  function loadIntoPrompt(text: string): void {
    const inputLines = text.split('\n');
    lines.length = 0;
    if (inputLines.length === 1) {
      line = inputLines[0];
      cursor = line.length;
      activeLineIdx = 0;
      extraLines = 0;
    } else {
      activeLineIdx = inputLines.length - 1;
      line = inputLines[activeLineIdx];
      cursor = line.length;
      for (let i = 0; i < inputLines.length; i++) {
        if (i !== activeLineIdx) lines.push(inputLines[i]);
      }
      extraLines = lines.length;
      // Make room for extra lines
      const rows = termHeight();
      const scrollBottom = rows - promptHeight();
      if (extraLines > 0) {
        process.stdout.write(
          `\x1b[1;${scrollBottom}r` +
          `\x1b[${scrollBottom};1H` +
          '\n'.repeat(extraLines) +
          `\x1b[1;${rows}r`
        );
      }
    }
    pasteBlocks.length = 0;
    pasteCounter = 0;
    drawPromptArea();
  }

  // Get all lines with paste placeholders expanded to their full content
  function allLinesExpanded(): string[] {
    const display = allLines();
    const result: string[] = [];
    for (const displayLine of display) {
      let expanded = displayLine;
      expanded = expanded.replace(/\[Pasted text #(\d+) \+\d+ lines?\]/g, (_match, idStr) => {
        const id = parseInt(idStr, 10);
        const block = pasteBlocks.find(b => b.id === id);
        return block ? block.content : _match;
      });
      result.push(...expanded.split('\n'));
    }
    return result;
  }

  // Process buffered paste content — fold large pastes into placeholder
  function processPasteBuffer(): void {
    if (!pasteBuffer) return;

    const normalized = pasteBuffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const pastedLines = normalized.split('\n');
    if (pastedLines.length > 1 && pastedLines[pastedLines.length - 1] === '') pastedLines.pop();

    if (pastedLines.length >= PASTE_FOLD_THRESHOLD) {
      pasteCounter++;
      const id = pasteCounter;
      const content = pastedLines.join('\n');
      pasteBlocks.push({ id, content });

      const placeholder = `[Pasted text #${id} +${pastedLines.length} lines]`;
      line = line.slice(0, cursor) + placeholder + line.slice(cursor);
      cursor += placeholder.length;
      drawActiveLine();
    } else {
      // Small paste — insert normally
      for (const ch of normalized) {
        if (ch === '\n') {
          handleContinuation();
        } else {
          line = line.slice(0, cursor) + ch + line.slice(cursor);
          cursor++;
        }
      }
      drawPromptArea();
    }
    pasteBuffer = '';
  }

  // Draw the entire prompt area: top divider, all lines, bottom divider, status
  function drawPromptArea(): void {
    const rows = termHeight();
    const height = promptHeight();
    const topRow = rows - height + 1;
    const all = allLines();

    let seq = '';

    // Top divider
    seq += `\x1b[${topRow};1H\x1b[2K` + hrLine();

    // All editable lines
    for (let i = 0; i < all.length; i++) {
      const row = topRow + 1 + i;
      const isActive = i === activeLineIdx;
      const prefix = isActive ? `${BOLD}${WHITE}${PROMPT_CHAR}${RESET} ` : '  ';
      seq += `\x1b[${row};1H\x1b[2K` + prefix + stylePastePlaceholders(all[i]);
    }

    // Bottom divider
    seq += `\x1b[${rows - 1};1H\x1b[2K` + hrLine();

    // Status
    seq += `\x1b[${rows};1H\x1b[2K${PINK}  ${currentStatus}${RESET}`;

    // Position cursor on active line
    const activeRow = topRow + 1 + activeLineIdx;
    const col = 2 + cursor + 1; // prefix is always 2 visible chars
    seq += `\x1b[${activeRow};${col}H`;

    process.stdout.write(seq);
  }

  // Redraw just the active line and position cursor
  function drawActiveLine(): void {
    const rows = termHeight();
    const height = promptHeight();
    const topRow = rows - height + 1;
    const activeRow = topRow + 1 + activeLineIdx;
    const prefix = `${BOLD}${WHITE}${PROMPT_CHAR}${RESET} `;
    const col = 2 + cursor + 1;

    process.stdout.write(
      `\x1b[${activeRow};1H\x1b[2K` +
      prefix + stylePastePlaceholders(line) +
      `\x1b[${activeRow};${col}H`
    );
  }

  function drawStatusLine(): void {
    const rows = termHeight();
    // Save/restore cursor so we don't disrupt input position
    process.stdout.write(
      '\x1b[s' +
      `\x1b[${rows};1H\x1b[2K${PINK}  ${currentStatus}${RESET}` +
      '\x1b[u'
    );
  }

  // ── Activate ──

  function activate(): void {
    promptActive = true;
    extraLines = 0;

    // Make room at the bottom
    process.stdout.write('\n'.repeat(BASE_PROMPT_LINES));

    // Draw the 4-line area
    drawPromptArea();

    // Enable raw mode + bracketed paste
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdout.write('\x1b[?2004h'); // enable bracketed paste mode
    process.stdin.resume();
    process.stdin.on('data', onKeypress);
  }

  // ── Multiline continuation ──
  // The prompt area grows: top divider moves up, new line added between dividers

  function handleContinuation(): void {
    // Merge current line back, insert new empty line after it
    const all = allLines();
    all.splice(activeLineIdx + 1, 0, '');
    activeLineIdx = activeLineIdx + 1;
    line = '';
    cursor = 0;
    lines.length = 0;
    for (let i = 0; i < all.length; i++) {
      if (i !== activeLineIdx) lines.push(all[i]);
    }
    extraLines = lines.length; // lines.length = total - 1 = extra lines beyond the 1 in BASE

    // We need one more row for the prompt area — scroll scrollback up by 1
    const rows = termHeight();
    const scrollBottom = rows - promptHeight();

    // Use scroll region to push scrollback up, making room for the taller prompt
    process.stdout.write(
      `\x1b[1;${scrollBottom + 1}r` +   // scroll region includes the row we're claiming
      `\x1b[${scrollBottom + 1};1H` +   // move to bottom of region
      '\n' +                             // scroll up
      `\x1b[1;${rows}r`                 // reset scroll region
    );

    // Redraw the entire prompt area at new size
    drawPromptArea();
  }

  // ── Keypress handler ──

  function onKeypress(data: Buffer): void {
    if (closed) return;

    const str = data.toString('utf8');

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const code = str.charCodeAt(i);

      // ESC sequence
      if (ch === '\x1b' && i + 1 < str.length) {
        if (str[i + 1] === '[' && i + 2 < str.length) {
          let j = i + 2;
          let params = '';
          while (j < str.length && (str[j] >= '0' && str[j] <= '9' || str[j] === ';')) {
            params += str[j];
            j++;
          }
          const terminator = j < str.length ? str[j] : '';

          // Bracketed paste: \x1b[200~ (start) and \x1b[201~ (end)
          if (terminator === '~' && params === '200') {
            pasting = true;
            pasteBuffering = true;
            pasteBuffer = '';
            i = j;
            continue;
          }
          if (terminator === '~' && params === '201') {
            pasting = false;
            if (pasteBuffering) {
              pasteBuffering = false;
              processPasteBuffer();
            }
            i = j;
            continue;
          }

          // CSI u: \x1b[keycode;modifiers u  (Shift+Enter = \x1b[13;2u)
          if (terminator === 'u') {
            const keycode = parseInt(params.split(';')[0], 10);
            if (keycode === 13) handleContinuation();
            i = j;
            continue;
          }

          // Arrow keys, Home, End
          if (terminator === 'C') { if (cursor < line.length) cursor++; drawActiveLine(); }
          else if (terminator === 'D') { if (cursor > 0) cursor--; drawActiveLine(); }
          else if (terminator === 'A') {
            // Up arrow — navigate to previous line (or history at top)
            if (activeLineIdx > 0) {
              switchToLine(activeLineIdx - 1);
              drawPromptArea();
            } else {
              // History navigation — go to older entry
              const len = historyLength();
              if (len > 0) {
                let newIdx = historyIndex;
                if (historyIndex === -1) {
                  savedInput = allLines().join('\n');
                  newIdx = len - 1; // most recent
                } else if (historyIndex > 0) {
                  newIdx = historyIndex - 1;
                }
                if (newIdx !== historyIndex) {
                  historyIndex = newIdx;
                  // Clear extra lines before loading history
                  if (extraLines > 0) {
                    const rows = termHeight();
                    const oldTopRow = rows - promptHeight() + 1;
                    const newTopRow = rows - BASE_PROMPT_LINES + 1;
                    for (let r = oldTopRow; r < newTopRow; r++) {
                      process.stdout.write(`\x1b[${r};1H\x1b[2K`);
                    }
                    extraLines = 0;
                    lines.length = 0;
                  }
                  const text = getHistoryDisplay(historyIndex);
                  if (text) loadIntoPrompt(text);
                }
              }
            }
          }
          else if (terminator === 'B') {
            // Down arrow — navigate to next line (or history at bottom)
            const totalLines = lines.length + 1;
            if (activeLineIdx < totalLines - 1) {
              switchToLine(activeLineIdx + 1);
              drawPromptArea();
            } else if (historyIndex >= 0) {
              // History navigation — go to newer entry or back to current input
              const len = historyLength();
              if (historyIndex < len - 1) {
                historyIndex++;
                // Clear extra lines before loading
                if (extraLines > 0) {
                  const rows = termHeight();
                  const oldTopRow = rows - promptHeight() + 1;
                  const newTopRow = rows - BASE_PROMPT_LINES + 1;
                  for (let r = oldTopRow; r < newTopRow; r++) {
                    process.stdout.write(`\x1b[${r};1H\x1b[2K`);
                  }
                  extraLines = 0;
                  lines.length = 0;
                }
                const text = getHistoryDisplay(historyIndex);
                if (text) loadIntoPrompt(text);
              } else {
                // Back to current input
                historyIndex = -1;
                if (extraLines > 0) {
                  const rows = termHeight();
                  const oldTopRow = rows - promptHeight() + 1;
                  const newTopRow = rows - BASE_PROMPT_LINES + 1;
                  for (let r = oldTopRow; r < newTopRow; r++) {
                    process.stdout.write(`\x1b[${r};1H\x1b[2K`);
                  }
                  extraLines = 0;
                  lines.length = 0;
                }
                loadIntoPrompt(savedInput);
                savedInput = '';
              }
            }
          }
          else if (terminator === '~' && params === '3') {
            // Delete key — forward delete
            if (cursor < line.length) {
              line = line.slice(0, cursor) + line.slice(cursor + 1);
              drawActiveLine();
            } else {
              // At EOL — merge next line into current
              const totalLines = lines.length + 1;
              if (activeLineIdx < totalLines - 1) {
                const all = allLines();
                line += all[activeLineIdx + 1];
                all.splice(activeLineIdx + 1, 1);
                lines.length = 0;
                for (let li = 0; li < all.length; li++) {
                  if (li !== activeLineIdx) lines.push(all[li]);
                }
                const rows = termHeight();
                const oldTopRow = rows - promptHeight() + 1;
                extraLines = lines.length;
                process.stdout.write(`\x1b[${oldTopRow};1H\x1b[2K`);
                drawPromptArea();
              }
            }
          }
          else if (terminator === 'H') { cursor = 0; drawActiveLine(); }
          else if (terminator === 'F') { cursor = line.length; drawActiveLine(); }

          i = j;
          continue;
        }
        i += 1;
        continue;
      }

      // Buffer paste content instead of processing immediately
      if (pasteBuffering) {
        pasteBuffer += ch;
        continue;
      }

      // Ctrl+C
      if (code === 3) { if (sigintHandler) sigintHandler(); continue; }

      // Ctrl+D
      if (code === 4) {
        if (line.length === 0 && lines.length === 0) {
          if (closeHandler) closeHandler();
        }
        continue;
      }

      // Enter
      if (ch === '\r' || ch === '\n') {
        if (line.endsWith('\\')) {
          line = line.slice(0, -1);
          handleContinuation();
          continue;
        }

        const displayInput = allLines().join('\n');
        const fullInput = pasteBlocks.length > 0 ? allLinesExpanded().join('\n') : displayInput;

        // Save to history (skip empty and question prompts)
        if (!questionCb && fullInput.trim()) {
          addHistory(fullInput, displayInput);
        }

        // Clear released prompt area rows before shrinking
        if (extraLines > 0) {
          const rows = termHeight();
          const oldTopRow = rows - promptHeight() + 1;
          const newTopRow = rows - BASE_PROMPT_LINES + 1;
          for (let r = oldTopRow; r < newTopRow; r++) {
            process.stdout.write(`\x1b[${r};1H\x1b[2K`);
          }
        }

        lines.length = 0;
        line = '';
        cursor = 0;
        activeLineIdx = 0;
        extraLines = 0;
        pasteBlocks.length = 0;
        pasteCounter = 0;
        historyIndex = -1;
        savedInput = '';

        // Redraw prompt area at base size
        drawPromptArea();

        if (questionCb) {
          const cb = questionCb;
          questionCb = null;
          cb(fullInput);
        } else if (submitHandler) {
          submitHandler(fullInput, displayInput);
        }
        continue;
      }

      // Backspace
      if (code === 127 || code === 8) {
        if (cursor > 0) {
          line = line.slice(0, cursor - 1) + line.slice(cursor);
          cursor--;
          drawActiveLine();
        } else if (activeLineIdx > 0) {
          // At start of line — merge into previous line (unwrap)
          const all = allLines();
          const prevContent = all[activeLineIdx - 1];
          all[activeLineIdx - 1] = prevContent + all[activeLineIdx];
          all.splice(activeLineIdx, 1);
          activeLineIdx--;
          line = all[activeLineIdx];
          cursor = prevContent.length;
          lines.length = 0;
          for (let li = 0; li < all.length; li++) {
            if (li !== activeLineIdx) lines.push(all[li]);
          }
          const rows = termHeight();
          const oldTopRow = rows - promptHeight() + 1;
          extraLines = lines.length;
          process.stdout.write(`\x1b[${oldTopRow};1H\x1b[2K`);
          drawPromptArea();
        }
        continue;
      }

      // Ctrl+A — home
      if (code === 1) { cursor = 0; drawActiveLine(); continue; }
      // Ctrl+E — end
      if (code === 5) { cursor = line.length; drawActiveLine(); continue; }
      // Ctrl+K — kill to end
      if (code === 11) { line = line.slice(0, cursor); drawActiveLine(); continue; }
      // Ctrl+U — kill to start
      if (code === 21) { line = line.slice(cursor); cursor = 0; drawActiveLine(); continue; }
      // Ctrl+W — delete word back
      if (code === 23) {
        const before = line.slice(0, cursor);
        const trimmed = before.replace(/\s*\S+\s*$/, '');
        line = trimmed + line.slice(cursor);
        cursor = trimmed.length;
        drawActiveLine();
        continue;
      }

      // Tab — ignore
      if (code === 9) continue;

      // Printable character
      if (code >= 32) {
        line = line.slice(0, cursor) + ch + line.slice(cursor);
        cursor++;
        drawActiveLine();
      }
    }
  }

  // ── Resize handler ──

  process.stdout.on('resize', () => {
    if (!promptActive) return;
    drawPromptArea();
  });

  // ── question() for rl compatibility ──

  function question(prompt: string, cb: (answer: string) => void): void {
    questionPromptText = prompt;
    questionCb = cb;
    drawActiveLine();
  }

  return {
    rl: { question },
    onSubmit(handler) { submitHandler = handler; },
    onClose(handler) { closeHandler = handler; },
    onSigint(handler) { sigintHandler = handler; },
    setStatus(text: string) {
      currentStatus = text;
      if (promptActive) drawStatusLine();
    },
    updateStatus(text: string) { currentStatus = text; },
    writeAbove,
    prompt() {
      if (!promptActive) {
        activate();
      } else {
        line = '';
        cursor = 0;
        activeLineIdx = 0;
        extraLines = 0;
        lines.length = 0;
        pasteBlocks.length = 0;
        pasteCounter = 0;
        historyIndex = -1;
        savedInput = '';
        drawPromptArea();
      }
    },
    close() {
      closed = true;
      promptActive = false;
      extraLines = 0;
      process.stdout.write('\x1b[?2004l'); // disable bracketed paste mode
      process.stdin.removeListener('data', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      const rows = termHeight();
      process.stdout.write(`\x1b[${rows};1H\n`);
    },
  };
}
