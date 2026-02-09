---
name: rho-onboard
description: "Install and configure Rho from scratch (Doom-style init.toml + sync). Only prereq: a coding agent that can run shell commands."
---

# Rho Onboarding SOP

## Overview

This SOP installs **pi**, installs **rho** via npm, generates a starter config in `~/.rho/`, syncs it into pi (`settings.json` filtering), and verifies the setup with `rho doctor`.

## Parameters

- **agent_name** (optional, default: "rho"): Name to write into `~/.rho/init.toml`.
- **heartbeat_interval** (optional, default: "30m"): Heartbeat interval written to `[settings.heartbeat].interval`.
- **platform** (optional): Auto-detect (android/macos/linux).

## Steps

### 1. Detect environment

**Constraints:**
- You MUST print OS + shell + node version (if present).
- You MUST NOT assume Termux unless `$TERMUX_VERSION` is set (because SSH servers can be Linux).

```bash
uname -a
printf "SHELL=%s\n" "$SHELL"
command -v node >/dev/null && node -v || echo "node: missing"
command -v npm  >/dev/null && npm -v  || echo "npm: missing"
command -v tmux >/dev/null && tmux -V || echo "tmux: missing"
command -v pi   >/dev/null && pi --version || echo "pi: missing"
command -v rho  >/dev/null && rho --version || echo "rho: missing"
```

### 2. Install system dependencies

**Constraints:**
- You MUST ensure: Node.js >= 20, npm, tmux.
- On Android/Termux you SHOULD install via `pkg` (because it is the standard package manager).

#### Android / Termux

```bash
pkg update -y
pkg install -y nodejs-lts tmux
```

#### macOS

```bash
# Requires Homebrew
brew install node tmux
```

#### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y nodejs npm tmux
```

### 3. Install pi

**Constraints:**
- You MUST install pi globally if missing.

```bash
command -v pi >/dev/null || npm install -g @mariozechner/pi-coding-agent
pi --version
```

### 4. Install rho

**Constraints:**
- You MUST install via npm.

```bash
npm install -g @rhobot-dev/rho
rho --version
```

### 5. Initialize config

**Constraints:**
- You MUST NOT overwrite existing `~/.rho/init.toml` (because it may contain real user configuration).

```bash
rho init --name "${AGENT_NAME:-rho}"
```

Then set heartbeat interval in `~/.rho/init.toml`:
- Find `[settings.heartbeat]`
- Set `interval = "30m"` (or the user's requested value)

### 6. Sync config into pi

**Constraints:**
- You MUST run `rho sync` after editing config.

```bash
rho sync
```

### 7. Verify

**Constraints:**
- You MUST run `rho doctor` and stop if it reports failures.

```bash
rho doctor
```

### 8. Optional: start the daemon

**Constraints:**
- You MUST ask the user before starting background processes (because it changes system state).

```bash
rho
```

### 9. Optional: tmux walkthrough

If the user is unfamiliar with tmux, explain only the essentials:
- detach: `Ctrl-b d`
- list sessions: `tmux ls`
- attach: `tmux attach -t rho`
- kill session: `tmux kill-session -t rho`

## Troubleshooting

- **`rho sync` says pi is missing**: run `npm install -g @mariozechner/pi-coding-agent`.
- **`rho doctor` shows settings.json out of sync**: run `rho sync`.
- **tmux missing**: install tmux with your platform's package manager.
