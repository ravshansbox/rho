# rho

An AI agent that lives on your phone. Not a cloud service, not a browser tab -- a persistent agent running in your pocket with memory, a heartbeat, and the ability to see and touch your screen.

Built on [pi coding agent](https://github.com/badlogic/pi-mono).

![Rho demo](docs/demo.gif)

## Install

Prerequisites: [Termux](https://f-droid.org/packages/com.termux/) and [Termux:API](https://f-droid.org/packages/com.termux.api/) from F-Droid.

Then one command:

```bash
curl -fsSL https://raw.githubusercontent.com/mikeyobrien/rho/main/bootstrap.sh | bash
```

This installs everything: Node.js, pi, rho extensions, skills, brain, and walks you through API key setup.

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

## What it does

**Heartbeat**: Rho checks in periodically (default: 30 min). Each check-in reads your `~/RHO.md` checklist and `~/HEARTBEAT.md` scheduled tasks, runs what needs running, and reports back.

**Memory**: Persistent brain across sessions. Learnings, preferences, and context accumulate over time in `~/.pi/brain/`. Your agent remembers what you told it yesterday.

**Tasker integration** *(optional)*: With [Tasker](https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm) installed, your agent can read screens, tap buttons, open apps, scroll, and type. It can use your phone like you do.

**Skills**: On-demand capability packages for common tasks -- clipboard, notifications, SMS, camera, speech-to-text, location, and more. The agent loads them when needed.

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

## Extensions

| Extension | What it does |
|-----------|-------------|
| `rho.ts` | Heartbeat, check-ins, continuous presence |
| `brain.ts` | Persistent memory across sessions |
| `brave-search.ts` | Web search via Brave API |
| `tasker.ts` | Android UI automation via Tasker |

## Skills

Rho comes with skills for common Android tasks. The agent loads them on demand:

| Skill | Capability |
|-------|-----------|
| `termux-notification` | System notifications with buttons |
| `termux-sms` | Read and send SMS |
| `termux-stt` | Speech-to-text |
| `termux-tts` | Text-to-speech |
| `termux-clipboard` | Clipboard read/write |
| `termux-media` | Audio, camera, recording |
| `termux-location` | GPS/network location |
| `termux-contacts` | Contact lookup |
| `termux-device` | Battery, torch, vibration |
| `termux-dialog` | Interactive input dialogs |
| `tasker-xml` | Create Tasker automations |
| `code-assist` | TDD-based code implementation |
| `pdd` | Prompt-driven design documents |

## Tasker setup (optional)

For UI automation (reading screens, tapping elements, controlling apps):

1. Install [Tasker](https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm) and [AutoInput](https://play.google.com/store/apps/details?id=com.joaomgcd.autoinput)
2. In Tasker: long-press home icon → Import Project → select `tasker/Rho.prj.xml`
3. Enable the imported profiles

Optional (screenshot without permission dialog):
```bash
# Enable wireless ADB in Developer Options, then:
adb pair <ip>:<port> <pairing-code>
adb connect <ip>:<port>
adb shell appops set net.dinglisch.android.taskerm PROJECT_MEDIA allow
```

## Project structure

```
rho/
├── extensions/         # Pi extensions (heartbeat, memory, search, tasker)
├── skills/             # On-demand capability packages
├── scripts/            # Daemon management (rho, rho-daemon, rho-stop, etc.)
├── tasker/             # Importable Tasker profiles
├── brain/              # Default brain files
├── bootstrap.sh        # One-command installer
├── install.sh          # Setup script (symlinks, templates, brain)
├── AGENTS.md.template  # Agent operating principles template
├── RHO.md.template     # Check-in checklist template
└── HEARTBEAT.md.template # Scheduled tasks template
```

## Environment variables

```bash
BRAVE_API_KEY="..."     # For web search (optional)
```

## Links

- [Demo walkthrough](docs/demo.md)
- [pi coding agent](https://github.com/badlogic/pi-mono)
- [@tau_rho_ai](https://x.com/tau_rho_ai) -- Tau, an agent running on rho
