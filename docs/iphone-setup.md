# iPhone / iPad Setup

Rho runs on a server. You connect from your iPhone using an SSH client. The agent keeps running when you disconnect -- reconnect anytime and pick up where you left off.

```
iPhone (Termius) --SSH--> Server (Rho in tmux)
```

## What you need

- A server running Rho (home machine, VPS, or cloud instance)
- An SSH client on your iPhone ([Termius](https://apps.apple.com/app/termius-terminal-ssh-client/id549039908) recommended, or [Blink Shell](https://apps.apple.com/app/blink-shell-build-code/id1594898306))

## 1. Install Rho on your server

SSH into your server from a computer (or do this from your phone):

```bash
git clone https://github.com/mikeyobrien/rho.git ~/projects/rho
cd ~/projects/rho && ./install.sh
rho login
```

The installer sets up a mobile-friendly tmux config automatically.

Start Rho:

```bash
rho
```

## 2. Set up Termius on your iPhone

1. Install [Termius](https://apps.apple.com/app/termius-terminal-ssh-client/id549039908) from the App Store
2. Open Termius and tap **+** to add a new host
3. Enter your server's hostname/IP, username, and SSH key or password
4. Tap the host to connect

Once connected:

```bash
rho
```

That's it. You're talking to your agent.

## 3. Reconnecting after disconnect

When your iPhone sleeps or you close Termius, the SSH connection drops but Rho keeps running in tmux on the server. When you reconnect:

```bash
rho
```

This reattaches to the existing session. Nothing is lost -- scroll up to see what happened while you were away. The heartbeat kept running the whole time.

## Termius tips

**Keyboard toolbar**: Termius has a configurable toolbar above the keyboard. Add these keys for a better Rho experience:
- `Ctrl` (for tmux prefix Ctrl-a)
- `Tab` (for pi autocompletion)
- `Esc` (for canceling)
- Arrow keys (for scrolling/navigation)

**Font size**: Settings > Terminal > Font Size. 14-16pt works well on iPhone, 12-14pt on iPad.

**Keep alive**: Settings > Terminal > SSH Keep Alive. Set to 30 seconds to prevent idle disconnects.

**Snippets**: Save `rho` as a Termius snippet so you can run it with one tap after connecting.

## Home server with Tailscale

If your server is a home machine (Mac Mini, Raspberry Pi, old laptop), use [Tailscale](https://tailscale.com/) for remote access without port forwarding:

1. Install Tailscale on your server: https://tailscale.com/download
2. Install Tailscale on your iPhone from the App Store
3. Sign in to both with the same account
4. In Termius, use the Tailscale IP (100.x.x.x) as your host address

Tailscale is free for personal use (up to 100 devices).

## VPS options

No home server? See [VPS setup guide](vps-setup.md) for options starting at $0/month (Oracle Cloud free tier).

## tmux basics

Rho's tmux config uses `Ctrl-a` as the prefix (not the default `Ctrl-b` -- easier on mobile).

| Action | Keys |
|--------|------|
| Detach (leave running) | `Ctrl-a d` |
| Split vertical | `Ctrl-a \|` |
| Split horizontal | `Ctrl-a -` |
| Switch pane | `Alt + arrow` |
| Scroll up | `Ctrl-a [` then arrows |
| Exit scroll | `q` |
| Reload config | `Ctrl-a r` |
