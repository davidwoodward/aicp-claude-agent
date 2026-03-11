## PROMPT 1: The Rendering Engine

> **Before starting, read `CLAUDISH-VISION.md` in this repo.** That file defines the two-region terminal architecture (pinned prompt area + scrollback) that everything in this prompt must conform to. Do not proceed until you have read and understood it.
>
> The project you are changing is ../aicp-claude-agent.

### Goal

Rework `src/terminal/prompt.ts` to maintain a pinned 4-line prompt area at the bottom of the terminal and expose a `writeAbove(text)` function that inserts lines into the scrollback above it.

Work incrementally instead of loading everything upfront so you don't blow past 32k output tokens.

### The Problem

Currently, `prompt.ts` renders a bottom bar (divider + status) below the cursor using `renderBelow()`, but it's an illusion — everything shares the same stream. During execution, output overwrites or pushes the prompt off screen. `showPrompt()` is called after execution to bring it back. The prompt is NOT pinned. It disappears during execution.

### What To Build

**`writeAbove(text: string)`** — the single most important function. Every line of output in the entire application must go through this. It:

1. Saves the cursor position
2. Moves the cursor to the line just above the prompt area (4 lines up from bottom: top divider, input, bottom divider, status)
3. Inserts a new line with `text` (using ANSI scroll-up / insert-line sequences)
4. Restores the cursor to the correct position in the input line

This must work correctly while:
- The user is mid-typing (cursor position in input line preserved)
- The spinner is animating (spinner calls writeAbove too)
- readline is active and processing keystrokes
- Multiple rapid writes happen (streaming text)

**Rework the prompt area** to be truly pinned:
- On creation, reserve the bottom 4 lines by writing them and positioning the cursor
- `readline` input happens on line 2 of the reserved area
- The top divider, bottom divider, and status bar are redrawn as needed (e.g., on terminal resize)
- `showPrompt()` no longer needs to exist as a "re-show after hiding" — the prompt is always there

**Status bar updates** continue to work via `setStatus(text)` / `updateStatus(text)` — these only touch the status line (line 4 of the reserved area), never the scrollback.

### What NOT To Build

- Do NOT touch the spinner (`spinner.ts`) in this prompt — that's Prompt 2
- Do NOT touch `main.ts` wiring — that's Prompt 3
- Do NOT change `sdk.ts` — it's already done

### Existing Code to Rework

`src/terminal/prompt.ts` currently has:
- `createPrompt()` → `StyledRL` with readline, multiline, status bar
- `renderBelow()` — renders divider + status below cursor (replace with pinned region)
- `updateStatusInPlace()` — updates status without scrolling (keep, adapt to pinned region)
- `printBanner()`, `printStatus()`, `printInfo()`, `printError()`, `printDivider()` — all use `console.log()` (must be changed to use `writeAbove()`)

### Interface After This Prompt

```typescript
export interface StyledRL {
  rl: readline.Interface;
  onSubmit(handler: (input: string) => void): void;
  onClose(handler: () => void): void;
  onSigint(handler: () => void): void;
  setStatus(text: string): void;       // update status bar in pinned area
  updateStatus(text: string): void;    // update stored status text
  writeAbove(text: string): void;      // INSERT text into scrollback above prompt
  prompt(): void;                      // no-op or soft reset (prompt is always visible)
  close(): void;
}

// These must all route through writeAbove internally:
export function printBanner(): void;
export function printStatus(text: string): void;
export function printInfo(text: string): void;
export function printError(text: string): void;
export function printDivider(): void;
export function printUserMessage(text: string): void;

// Standalone writeAbove for use before StyledRL is created (banner, startup info):
export function writeAbove(text: string): void;
```

### Terminal Resize Handling

When the terminal resizes, the prompt area must be redrawn at the new width. Listen for `process.stdout.on('resize', ...)` and redraw the dividers and status bar.

### Verification

- [ ] `npm run build` compiles
- [ ] Create the prompt — 4-line pinned area appears at bottom
- [ ] Call `writeAbove('hello')` — "hello" appears above the prompt, prompt stays pinned
- [ ] Call `writeAbove()` rapidly 50 times — all lines appear, prompt stays pinned, no visual glitches
- [ ] Type text in input — cursor stays in input line between dividers
- [ ] Multiline input (Shift+Enter) — works within prompt area
- [ ] `setStatus('new status')` — status bar updates, scrollback untouched
- [ ] Terminal resize — prompt area redraws at new width

---

## PROMPT 2: Rewire the Spinner

> **Before starting, read `CLAUDISH-VISION.md` in this repo.** That file defines the two-region terminal architecture (pinned prompt area + scrollback) that everything in this prompt must conform to. Do not proceed until you have read and understood it.
>
> The project you are changing is ../aicp-claude-agent.

### Goal

Rework `src/terminal/spinner.ts` to render in the scrollback region using `writeAbove()` from `prompt.ts`, instead of writing at the cursor with `\r\x1b[2K`.

Work incrementally instead of loading everything upfront so you don't blow past 32k output tokens.

### The Problem

The spinner currently uses `process.stdout.write('\r\x1b[2K' + line)` to overwrite the current line in-place. This writes at the cursor position, which is inside the pinned prompt area — it will overwrite the user's input line. The spinner must instead write into the scrollback above the prompt.

### What To Build

The spinner needs to maintain ONE line in the scrollback that it overwrites each frame. This means:

1. **First frame**: Call `writeAbove(spinnerLine)` to insert a new line into the scrollback
2. **Subsequent frames**: Overwrite that same line (the last line of scrollback, just above the prompt area) rather than inserting new lines

This requires a new primitive from `prompt.ts`: **`updateAbove(text: string)`** — overwrites the last line written to scrollback (the line immediately above the prompt area) without inserting a new line. The spinner alternates between `writeAbove` (first frame) and `updateAbove` (subsequent frames).

Alternatively, the spinner can manage this internally by tracking whether it has an active line in scrollback and using cursor movement to overwrite it.

**`stopSpinner()`** must clear the spinner line from scrollback (so assistant text doesn't appear below a stale spinner line).

### What NOT To Change

- `spinner.ts` already has: frames, verb map, token formatting, start/stop/update API — keep all of that
- `sdk.ts` — already done, don't touch
- `main.ts` — that's Prompt 3

### Verification

- [ ] `npm run build` compiles
- [ ] Call `startSpinner()` — spinner line appears in scrollback, animating, prompt area untouched
- [ ] Call `updateSpinnerVerb('Read')` — verb changes to "Reading..."
- [ ] Call `stopSpinner()` — spinner line disappears from scrollback
- [ ] Start spinner, then call `writeAbove('some text')` — text appears above spinner, spinner continues on its line
- [ ] Rapid start/stop cycles — no visual artifacts, no orphaned lines

---

## PROMPT 3: Wire Everything in main.ts

> **Before starting, read `CLAUDISH-VISION.md` in this repo.** That file defines the two-region terminal architecture (pinned prompt area + scrollback) that everything in this prompt must conform to. Do not proceed until you have read and understood it.
>
> The project you are changing is ../aicp-claude-agent.

### Goal

Rework `src/main.ts` to use `writeAbove()` for all execution output, keeping the prompt visible and usable at all times.

Work incrementally instead of loading everything upfront so you don't blow past 32k output tokens.

### The Problem

`main.ts` currently:
- Calls `console.log(msg.text)` for user messages — writes at cursor, breaks prompt
- Calls `process.stdout.write(text)` for streaming assistant text — writes at cursor, breaks prompt
- Calls `showPrompt()` after execution — implies prompt was hidden during execution
- Calls `printStatus()`, `printInfo()`, etc. — these use `console.log()` internally

ALL of these must route through `writeAbove()`.

### What To Change

**User message echo** (`handleExecutePrompt`):
- Replace `printUserMessage(msg.text)` with `writeAbove()` calls that write the user's text as plain text into scrollback

**Streaming assistant text** (`onProgress` callback):
- Replace `process.stdout.write(text)` with buffered `writeAbove()` — accumulate text until a newline, then flush the complete line via `writeAbove()`
- Partial lines (no newline yet) can be written via `updateAbove()` to overwrite the current incomplete line

**Spinner lifecycle** (already wired via `onToolEvent`):
- `startSpinner()` before execution loop — already done, spinner now writes to scrollback
- `stopSpinner()` before assistant text — already done
- Tool event handlers — already done
- After execution: `stopSpinner()` — already done

**Remove `showPrompt()` pattern**:
- Delete or make `showPrompt()` a no-op — the prompt is always visible
- The only thing that changes between idle/executing is the status bar text
- On execution start: `styledRL.setStatus('esc to interrupt')`
- On execution end: `styledRL.setStatus(statusText())`

**Startup output** (`start()`, `onMessage registered`):
- `printBanner()`, `printInfo()`, `printStatus()` all already route through `writeAbove()` (done in Prompt 1)

**Stats display** (after execution):
- `printStatus(...)` already routes through `writeAbove()` (done in Prompt 1)

### What NOT To Change

- `sdk.ts` — already done
- `prompt.ts` — done in Prompt 1
- `spinner.ts` — done in Prompt 2

### Verification

- [ ] `npm run build` compiles
- [ ] Launch agent — banner and connection info appear in scrollback, prompt pinned at bottom
- [ ] Type a prompt and submit — text appears in scrollback, prompt clears, cursor back in input line
- [ ] During execution — spinner animates in scrollback, prompt area untouched
- [ ] Tool use — spinner verb changes (Reading, Executing, etc.)
- [ ] Assistant text streams — appears line-by-line in scrollback above prompt
- [ ] Execution completes — stats appear in scrollback, status bar reverts to idle
- [ ] Type during execution — input is accepted, cursor stays in prompt area
- [ ] Ctrl+C — status bar updates to "Press Ctrl+C again to exit", reverts after 1.5s
- [ ] Second execution after first — everything works again, no leftover state
- [ ] `npm run build` compiles with no errors
