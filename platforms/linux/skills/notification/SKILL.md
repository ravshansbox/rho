---
name: notification
description: Show Linux desktop notifications with title, body, urgency, and icons. Use for alerts, reminders, or status updates.
---

# Desktop Notifications

Requires `notify-send` from the `libnotify` package.

## Install
```bash
# Debian/Ubuntu
sudo apt install libnotify-bin

# Arch
sudo pacman -S libnotify

# Fedora
sudo dnf install libnotify
```

## Basic notification
```bash
notify-send "Title" "Message body"
```

## With urgency
```bash
notify-send -u low "Info" "Low priority message"
notify-send -u normal "Update" "Normal priority"
notify-send -u critical "Alert" "Critical -- won't auto-dismiss"
```

## With icon
```bash
notify-send -i dialog-information "Info" "With info icon"
notify-send -i dialog-warning "Warning" "With warning icon"
notify-send -i dialog-error "Error" "With error icon"
notify-send -i /path/to/icon.png "Custom" "With custom icon"
```

## With expiration (milliseconds)
```bash
notify-send -t 5000 "Title" "Disappears after 5 seconds"
notify-send -t 0 "Title" "Persistent until dismissed"
```

## With app name and category
```bash
notify-send -a "MyApp" -c "transfer" "Download" "Complete"
```

## Replaceable notification (update in place)
```bash
notify-send -h int:transient:1 -r 12345 "Progress" "50%"
notify-send -h int:transient:1 -r 12345 "Progress" "100%"
```

On headless/SSH systems without a display server, `notify-send` will fail. Use `wall` or write to a log file instead.
