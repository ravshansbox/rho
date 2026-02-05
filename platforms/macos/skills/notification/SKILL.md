---
name: notification
description: Show macOS system notifications with title, body, and optional sound. Use for alerts, reminders, or status updates.
---

# System Notifications

## Basic notification
```bash
osascript -e 'display notification "Message body" with title "Title"'
```

## With subtitle
```bash
osascript -e 'display notification "Body" with title "Title" subtitle "Subtitle"'
```

## With sound
```bash
osascript -e 'display notification "Body" with title "Title" sound name "default"'
```

## Common sound names
- `default` — system default
- `Basso`, `Blow`, `Bottle`, `Frog`, `Funk`, `Glass`, `Hero`, `Morse`, `Ping`, `Pop`, `Purr`, `Sosumi`, `Submarine`, `Tink`

## Richer notifications (optional)

For persistent or actionable notifications, install `terminal-notifier`:
```bash
brew install terminal-notifier
```

```bash
terminal-notifier -title "Title" -message "Body"
terminal-notifier -title "Title" -message "Body" -sound default
terminal-notifier -title "Title" -message "Body" -open "https://example.com"
terminal-notifier -title "Title" -message "Body" -group "mynotif"  # updatable by group
terminal-notifier -remove "mynotif"  # remove by group
```
