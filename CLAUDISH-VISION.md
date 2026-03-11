# Terminal UI: Pinned Prompt with Scrollback Output

## VISION

The terminal has TWO regions. They are separate and independent:

1. **Scrollback region** — everything above the prompt area. Output scrolls upward. This is where user messages, spinners, assistant text, and stats appear.
2. **Prompt area** — pinned to the bottom of the terminal. ALWAYS visible. NEVER disappears. The user can ALWAYS type, even during execution.

These two regions are NOT the same stream. The prompt area is reserved screen real estate. Output is inserted into the scrollback above it.

### Prompt Area Layout (bottom of terminal, always visible)

```
───────────────────────────────────────────────────────────────────
❯ |
───────────────────────────────────────────────────────────────────
⏵⏵ bypass permissions on  ·  42% context
```

Four lines, always present:
1. Top divider (full-width `─`)
2. Input line with `❯` prompt — user types here
3. Bottom divider (full-width `─`)
4. Status bar — left-aligned hints + right-aligned context info

After the user submits, the input line clears immediately. The `❯` prompt remains. The user can type again right away. They do NOT wait for execution to finish.

### Scrollback Behavior

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

### Status Bar Content

| State | Left side | Right side |
|-------|-----------|------------|
| Idle | `⏵⏵ bypass permissions on` | `42% context · 12.3k tokens` |
| Executing | `esc to interrupt` | `42% context · 12.3k tokens` |
| Ctrl+C pressed once | `Press Ctrl+C again to exit` | (same) |

---

