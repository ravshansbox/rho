# rho

A persistent AI agent with memory, a heartbeat, and platform-native capabilities. Runs on macOS, Linux, and Android.

Not a cloud service, not a browser tab -- an agent that lives where you do, remembers what you told it yesterday, and checks in on its own.

Built on [pi coding agent](https://github.com/badlogic/pi-mono).

![Rho demo](docs/demo.gif)

## Quick Start

### macOS / Linux

```bash
git clone https://github.com/mikeyobrien/rho.git ~/projects/rho
cd ~/projects/rho && ./install.sh
```

Prerequisites: Node.js (18+), tmux, git. The installer checks and tells you what's missing.

### Android (Termux)

Install [Termux](https://f-droid.org/packages/com.termux/) and [Termux:API](https://f-droid.org/packages/com.termux.api/) from F-Droid, then:

```bash
curl -fsSL https://raw.githubusercontent.com/mikeyobrien/rho/main/platforms/android/bootstrap.sh | bash
```

Or step by step:

```bash
pkg install nodejs-lts tmux git
npm install -g @mariozechner/pi-coding-agent
git clone https://github.com/mikeyobrien/rho.git ~/projects/rho
cd ~/projects/rho && ./install.sh
```

## Run

```bash
rho           # Start and attach
rho -d        # Start in background
rho status    # Is it running?
rho stop      # Stop
```

Inside a session:

```
/rho status           Show heartbeat state
/rho now              Trigger check-in immediately
/rho interval 30m     Set check-in interval
/rho enable/disable   Toggle heartbeat
```

## What You Get

These work on every platform:

**Heartbeat** -- Rho checks in periodically (default: 30 min). Each check-in reads your `~/RHO.md` checklist and `~/HEARTBEAT.md` scheduled tasks, runs what needs running, and reports back.

**Memory** -- Persistent brain across sessions. Learnings, preferences, and context accumulate over time in `~/.pi/brain/`. Your agent remembers what you told it yesterday.

**Skills** -- On-demand capability packages the agent loads when needed. Core skills work everywhere; platform skills give native access to notifications, clipboard, speech, and more.

## Platform Capabilities

The installer detects your OS and installs the right skills automatically.

### Skills by Platform

| Skill | Android | macOS | Linux | Description |
|-------|:-------:|:-----:|:-----:|-------------|
| `notification` | ✓ | ✓ | ✓ | System notifications |
| `clipboard` | ✓ | ✓ | ✓ | Clipboard read/write |
| `tts` | ✓ | ✓ | ✓ | Text-to-speech |
| `open-url` | ✓ | ✓ | ✓ | Open URLs and apps |
| `sms` | ✓ | | | Read and send SMS |
| `stt` | ✓ | | | Speech-to-text |
| `media` | ✓ | | | Audio, camera, recording |
| `location` | ✓ | | | GPS/network location |
| `contacts` | ✓ | | | Contact lookup |
| `device` | ✓ | | | Battery, torch, vibration |
| `dialog` | ✓ | | | Interactive input dialogs |
| `tasker-xml` | ✓ | | | Create Tasker automations |
| `update-pi` | ✓ | ✓ | ✓ | Update pi to latest version |

### Extensions by Platform

| Extension | Platforms | Description |
|-----------|-----------|-------------|
| `rho.ts` | All | Heartbeat, check-ins, continuous presence |
| `brain.ts` | All | Persistent memory across sessions |
| `brave-search.ts` | All | Web search via Brave API |
| `memory-viewer.ts` | All | Browse and search memories |
| `usage-bars.ts` | All | Token/cost usage display |
| `moltbook-viewer.ts` | All | Moltbook post viewer |
| `tasker.ts` | Android | UI automation via Tasker |

## Customize

### RHO.md -- Your checklist

Create `~/RHO.md` with tasks for the heartbeat to check:

```markdown
# RHO Checklist

## Quick Scan
- [ ] Any unread notifications?
- [ ] Battery below 20%?

## Active Work  
- [ ] Check build status on ~/projects/myapp

## Recurring
- [ ] Run ~/backup.sh every 6 hours
```

### HEARTBEAT.md -- Scheduled tasks

Create `~/HEARTBEAT.md` for time-based triggers:

```markdown
# Heartbeat Tasks

## Weather
- Schedule: 8am daily
- Action: Check weather and notify if rain expected

## Journal
- Schedule: 9pm daily
- Action: Write daily journal entry to ~/notes/
```

### SOUL.md -- Personality

Create `~/SOUL.md` to give your agent a voice and identity. This is where you define who it is, what it cares about, and how it communicates.

### Brain

The brain lives at `~/.pi/brain/`:

- `core.jsonl` -- Behavior, identity
- `memory.jsonl` -- Learnings and preferences (grows over time)
- `context.jsonl` -- Project-specific context
- `memory/YYYY-MM-DD.md` -- Daily memory log

Use the `memory` tool or `/brain` command to interact with it.

## Tasker Setup (Android, optional)

For UI automation (reading screens, tapping elements, controlling apps):

1. Install [Tasker](https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm) and [AutoInput](https://play.google.com/store/apps/details?id=com.joaomgcd.autoinput)
2. In Tasker: long-press home icon > Import Project > select `tasker/Rho.prj.xml`
3. Enable the imported profiles

Optional (screenshot without permission dialog):
```bash
# Enable wireless ADB in Developer Options, then:
adb pair <ip>:<port> <pairing-code>
adb connect <ip>:<port>
adb shell appops set net.dinglisch.android.taskerm PROJECT_MEDIA allow
```

## Project Structure

```
rho/
├── extensions/              # Core extensions (all platforms)
│   ├── brain.ts
│   ├── brave-search.ts
│   ├── memory-viewer.ts
│   ├── moltbook-viewer.ts
│   ├── rho.ts
│   └── usage-bars.ts
├── skills/                  # Core skills (all platforms)
│   └── update-pi/
├── platforms/
│   ├── android/
│   │   ├── extensions/      # tasker.ts
│   │   ├── skills/          # notification, clipboard, sms, stt, tts, ...
│   │   ├── scripts/bin/     # stt, stt-send
│   │   └── bootstrap.sh     # One-command Termux installer
│   ├── macos/
│   │   ├── skills/          # notification, clipboard, open-url, tts
│   │   └── setup.sh         # Dependency checker
│   └── linux/
│       ├── skills/          # notification, clipboard, open-url, tts
│       └── setup.sh         # Dependency checker
├── scripts/                 # Daemon management
│   ├── rho                  # Start/attach
│   ├── rho-daemon           # Background daemon
│   ├── rho-status           # Status check
│   ├── rho-stop             # Stop daemon
│   └── rho-trigger          # Trigger check-in
├── brain/                   # Default brain files
├── tasker/                  # Importable Tasker profiles (Android)
├── install.sh               # Cross-platform installer
├── AGENTS.md.template       # Agent operating principles
├── RHO.md.template          # Check-in checklist
├── HEARTBEAT.md.template    # Scheduled tasks
└── SOUL.md.template         # Personality/voice
```

## Configuration

The installer writes `~/.config/rho/config` with:

```bash
RHO_DIR=/path/to/rho          # Where the repo lives
RHO_PLATFORM=android|macos|linux  # Detected platform
```

Scripts source this file at startup. You can override values manually.

## Adding a New Platform

1. Create `platforms/<name>/skills/` with SKILL.md files for platform-native capabilities
2. Optionally create `platforms/<name>/extensions/` for platform-specific extensions
3. Optionally create `platforms/<name>/setup.sh` to check/install dependencies
4. Add a detection case in `install.sh` (`detect_platform` function)
5. Submit a PR

## Environment Variables

```bash
BRAVE_API_KEY="..."     # For web search (optional)
```

## Links

- [Demo walkthrough](docs/demo.md)
- [pi coding agent](https://github.com/badlogic/pi-mono)
- [@tau_rho_ai](https://x.com/tau_rho_ai) -- Tau, an agent running on rho
