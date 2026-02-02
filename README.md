# rho

Personal configuration layer for [pi coding agent](https://github.com/badlogic/pi-mono). Pi is the base, Rho is the personality.

## Structure

```
rho/
├── extensions/         # Custom tools and event handlers
│   ├── brave-search.ts # Web search
│   └── brain.ts        # Persistent memory system
├── skills/             # On-demand capability packages
├── brain/              # Default brain files (copied on install)
├── AGENTS.md.template  # Identity template (injected on install)
└── install.sh          # Setup script
```

## Installation

```bash
git clone https://github.com/mikeyobrien/rho.git ~/projects/rho
cd ~/projects/rho
./install.sh
```

This will:
- Symlink extensions and skills to `~/.pi/agent/`
- Create `~/AGENTS.md` with your runtime environment
- Bootstrap `~/.pi/brain/` with defaults

## Extensions

- **brain.ts** — Persistent memory (learnings, preferences, context)
- **brave-search.ts** — Web search via Brave Search API

## Environment Variables

```bash
export BRAVE_API_KEY="your-key"  # Required for brave-search
```

## Brain

Rho uses a JSONL-based memory system at `~/.pi/brain/`:

- `core.jsonl` — Identity, behavior, user info
- `memory.jsonl` — Learnings and preferences (grows over time)
- `context.jsonl` — Project-specific context (matched by cwd)

Use the `memory` tool or `/brain` command to interact with it.
