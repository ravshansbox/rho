# Review Extension

A lightweight code review tool for pi — leave line-level comments on any file, like a personal PR review. Works as both a `/review` command and a `review` tool callable by the agent.

## Quick Start

```
/review src/server.ts
/review --tui src/server.ts
/review *.ts
/review src/
```

The agent can also invoke it:

```
review({ files: ["src/server.ts"], message: "Check the error handling" })
```

## How It Works

1. Files are resolved (paths, globs, directories)
2. A review UI opens — browser by default, or TUI with `--tui`
3. You comment on lines or ranges
4. On submit, comments are formatted as markdown and injected into the conversation
5. On cancel, nothing happens

Comments are **session-only** — they exist in the conversation context, not saved to disk alongside the files.

## Modes

### Browser (default)

Opens a local web UI at `http://127.0.0.1:<port>`. Uses the rho web server on `:3141` if running, otherwise starts a standalone ephemeral server on a random port.

Features:
- Syntax highlighting via highlight.js
- Click a line number to comment on it
- Shift+click for multi-line range selection
- Sidebar file picker (collapsible on mobile)
- Edit/delete existing comments inline
- Expand comment range with ▲/▼ buttons
- WebSocket connection — closing the browser tab cancels the review

### TUI (`--tui`)

Renders directly in the terminal using pi's custom UI system. No browser needed.

| Key | Action |
|---|---|
| `j` / `k` / `↑` / `↓` | Scroll |
| `g` / `G` | Top / bottom |
| `Ctrl+d` / `Ctrl+u` | Page down / up |
| `Enter` | Comment on current line |
| `v` | Start range selection |
| `Tab` / `Shift+Tab` | Next / previous file |
| `f` | File picker |
| `c` | Comment list (edit/delete) |
| `S` (shift+s) | Submit review |
| `Esc` | Cancel review |
| `?` | Help overlay |

In range mode, move the cursor to extend the selection, then `Enter` to comment or `Esc` to cancel.

## File Resolution

The extension accepts:

| Input | Behavior |
|---|---|
| `path/to/file.ts` | Single file |
| `*.ts` | Glob pattern |
| `src/` | All files in directory (non-recursive, one level) |
| Multiple args | Mix of the above |

**Skipped automatically:**
- Binary files
- Files over 500KB
- Missing paths

Skipped files appear as warnings in the review UI.

## Agent Tool

The `review` tool is available to the agent with this schema:

```typescript
{
  files: string[]    // required — file paths to open
  message?: string   // optional — context message shown in the UI
}
```

Returns either:
- Formatted review comments (markdown with file grouping, line numbers, quoted source)
- `"Review cancelled by user."`
- `"No files found matching the provided paths."`

The formatted output groups comments by file and includes quoted source context:

```markdown
## Review Comments

### src/server.ts

**Line 42:**
> const result = await fetch(url);

Consider adding a timeout here.

**Lines 55-60:**
> try {
>   await db.save(record);
> } catch (err) {
>   console.log(err);
> }

This should rethrow or handle the error properly.
```

## Architecture

```
extensions/review/
├── index.ts          # Extension entry — registers /review command + review tool
├── files.ts          # File resolution (paths, globs, dirs, binary detection)
├── format.ts         # Formats comments into markdown for the conversation
├── server.ts         # HTTP + WebSocket server (standalone + rho web integration)
├── tui.ts            # Terminal UI mode (pi custom component)
├── web/
│   ├── index.html    # Alpine.js SPA
│   ├── css/review.css
│   └── js/review.js
└── *.test.ts         # Tests for each module
```

The browser mode has two server strategies:
1. **Rho web integration** (preferred): Creates a review session on the existing rho web server at `:3141`, communicates via WebSocket
2. **Standalone fallback**: Spins up an ephemeral HTTP server on a random port, shuts down on submit/cancel

## Installation

The extension lives at `~/.pi/agent/extensions/review/`. Pi discovers it automatically via the `extensions/review/index.ts` entrypoint.

Dependencies are managed separately from the rho project:

```bash
cd ~/.pi/agent/extensions/review
npm install
```
