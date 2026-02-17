# Skills

Rho provides a single command for installing and managing third-party skills:

```bash
rho skills [--provider vercel|clawhub] <command> [args]
```

- Default provider: `vercel`
- Optional provider: `clawhub`

## Canonical commands

These commands are the same regardless of provider:

- `install` — install a skill package/slug
- `list` — list installed skills
- `show` — show details for one skill
- `update` — update installed skills
- `remove` — remove an installed skill
- `search` — discover skills

## Quick start (Vercel default)

```bash
# Install from a skills repo
rho skills install vercel-labs/agent-skills --skill web-design-guidelines

# Read/list/search
rho skills list
rho skills show web-design-guidelines
rho skills search react

# Update/remove
rho skills update
rho skills remove web-design-guidelines -y
```

Rho applies Pi-friendly defaults for Vercel installs:
- `--agent pi`
- `--global`

So skills become available in Pi under `~/.pi/agent/skills/`.

## ClawHub usage

```bash
# Discover and inspect
rho skills --provider clawhub search sonos
rho skills --provider clawhub show sonoscli --versions

# Install/update/remove
rho skills --provider clawhub install sonoscli
rho skills --provider clawhub update sonoscli
rho skills --provider clawhub remove sonoscli --yes
```

Rho applies ClawHub defaults:
- `--workdir ~/.pi/agent`
- `--dir skills`

So installs go directly to `~/.pi/agent/skills/<slug>`.

## Where files are stored

### Provider: vercel
- Pi-visible skill path: `~/.pi/agent/skills/<skill>`
- Canonical store: `~/.agents/skills/<skill>`
- Lockfile: `~/.agents/.skill-lock.json`

### Provider: clawhub
- Install path: `~/.pi/agent/skills/<slug>`
- Lockfile: `~/.pi/agent/.clawhub/lock.json`

## Raw CLI equivalents

### Vercel

```bash
npx skills add vercel-labs/agent-skills --skill web-design-guidelines --agent pi --global
```

### ClawHub

```bash
npx clawhub@latest --workdir ~/.pi/agent --dir skills install sonoscli
```

## Notes

- Provider-native flags are passed through (for example `--skill`, `--agent`, `--workdir`, `--dir`).
- `rho skills` prints contextual path output after successful installs.
