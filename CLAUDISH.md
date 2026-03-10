# Terminal UI: Pinned Prompt with Scrollback Output

## The Core Requirement

The terminal has TWO regions. They are separate and independent:

1. **Scrollback region** — everything above the prompt area. Output scrolls upward. This is where user messages, spinners, assistant text, and stats appear.
2. **Prompt area** — pinned to the bottom of the terminal. ALWAYS visible. NEVER disappears. The user can ALWAYS type, even during execution.

These two regions are NOT the same stream. The prompt area is reserved screen real estate. Output is inserted into the scrollback above it.

## Prompt Area Layout (bottom of terminal, always visible)

```
───────────────────────────────────────────────────────────────────
❯ |
───────────────────────────────────────────────────────────────────
⏵⏵ bypass permissions on  ·  42% context
```

Three lines, always present:
1. Top divider (full-width `─`)
2. Input line with `❯` prompt — user types here
3. Bottom divider (full-width `─`)
4. Status bar — left-aligned hints + right-aligned context info

After the user submits, the input line clears immediately. The `❯` prompt remains. The user can type again right away. They do NOT wait for execution to finish.

## Scrollback Behavior

When the user submits "What is the purpose of this project?", the scrollback looks like this:

```
What is the purpose of this
project?

⠹ Thinking... (2s)
```

The submitted text appears as plain text in the scrollback (no `❯` prefix, no background color). Then the spinner appears below it.

As the assistant streams text, the spinner is replaced by the streamed output:

```
What is the purpose of this
project?

This project is a CLI agent that wraps Claude Code and communicates
with the AICP backend via WebSocket. It allows...
```

When tools are invoked, the spinner reappears with the tool verb:

```
...communicates with the AICP backend via WebSocket.

⠹ Reading... (5s · ↓ 1.2k tokens · 42%)
```

When execution completes, stats appear:

```
...the project structure looks like this.

  3 turns | 4521 tokens | $0.0234 | 8.2s
```

Then the prompt area is just sitting there at the bottom, ready for the next input. It was there the whole time.

## Spinner Specification

- **Frames**: Braille dots `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` cycling at 80ms
- **Format**: `⠹ Verb... (Xs · ↓ N tokens · N%)`
- **Colors**: Teal spinner char, near-white verb, dim gray metadata
- **Tool verb map**: Read→Reading, Write→Writing, Edit→Editing, Bash→Executing, Glob/Grep→Searching, WebFetch→Fetching, WebSearch→Searching, Agent→Running agent, default→Thinking
- **Rendering**: Overwrites its own line in-place using `\r\x1b[2K`
- The spinner line lives in the scrollback, NOT in the prompt area

## Status Bar Content

| State | Left side | Right side |
|-------|-----------|------------|
| Idle | `⏵⏵ bypass permissions on` | `42% context · 12.3k tokens` |
| Executing | `esc to interrupt` | `42% context · 12.3k tokens` |
| Ctrl+C pressed once | `Press Ctrl+C again to exit` | (same) |

## How to Implement This

The key architectural challenge: `readline` and `console.log` both write at the cursor position. To make the prompt area "pinned," all output that goes to the scrollback must:

1. Save the cursor position
2. Move the cursor up above the prompt area (4 lines up: top divider, input, bottom divider, status)
3. Insert the output (scroll the existing scrollback content up)
4. Restore the cursor to the input line

Study how Claude Code's terminal rendering works — it solves this exact problem. The `@anthropic-ai/claude-agent-sdk` repo was analyzed specifically for this. The pattern uses ANSI escape sequences to maintain a reserved region at the bottom while writing output above it.

All `console.log()` calls in the execution path must go through a helper that writes above the prompt area. Direct `process.stdout.write()` and `console.log()` will break the layout by writing at/below the prompt.

## What Already Exists

The current codebase already has these pieces (some need modification):

- `src/terminal/spinner.ts` — Spinner animation module (frames, verb map, token display). Already built. Rendering needs to write above prompt area instead of at cursor.
- `src/terminal/prompt.ts` — Styled readline with status bar, multiline input, Ctrl+C handling. Needs to be reworked to reserve the bottom region and expose a `writeAbove(text)` method.
- `src/claude/sdk.ts` — `ToolEvent` type and `onToolEvent` callback already added. No changes needed.
- `src/main.ts` — Spinner lifecycle and tool event wiring already in place. Needs to use `writeAbove()` instead of `console.log()` for all execution output.

## Files to Change

1. **`src/terminal/prompt.ts`** — Rework to maintain a pinned 4-line bottom region. Add `writeAbove(text: string)` that inserts lines into scrollback above the prompt area. The readline input must remain functional at all times.
2. **`src/terminal/spinner.ts`** — Change rendering to use `writeAbove()` from prompt.ts instead of raw `\r\x1b[2K`. The spinner overwrites its own line in the scrollback (not in the prompt area).
3. **`src/main.ts`** — Replace all `console.log()` in execution flow with `writeAbove()`. Remove the pattern of hiding the prompt during execution and calling `showPrompt()` after. The prompt is always shown.

## Verification Checklist

- [ ] Launch agent — prompt area appears at bottom with dividers and status bar
- [ ] Type text — cursor is in the input line between the two dividers
- [ ] Submit — input clears, submitted text appears in scrollback above, prompt stays
- [ ] During execution — spinner animates in scrollback, prompt area untouched, cursor in input line
- [ ] Tool use — spinner verb changes (Reading, Executing, etc.)
- [ ] Assistant text streams — appears in scrollback above prompt area
- [ ] Execution completes — stats appear in scrollback, prompt area unchanged
- [ ] Type during execution — input is accepted, cursor stays in prompt area
- [ ] Ctrl+C — status bar updates to "Press Ctrl+C again to exit", reverts after 1.5s
- [ ] Multiline input (Shift+Enter) — works within the prompt area
- [ ] Terminal resize — prompt area adjusts to new width
- [ ] `npm run build` compiles with no errors
