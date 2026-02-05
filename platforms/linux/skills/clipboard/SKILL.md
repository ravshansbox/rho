---
name: clipboard
description: Read or write the Linux clipboard. Use when copying/pasting text, transferring data between apps, or accessing clipboard contents.
---

# Clipboard Operations

## X11 (xclip)

### Install
```bash
# Debian/Ubuntu
sudo apt install xclip

# Arch
sudo pacman -S xclip

# Fedora
sudo dnf install xclip
```

### Read clipboard
```bash
xclip -selection clipboard -o
```

### Write to clipboard
```bash
echo "text to copy" | xclip -selection clipboard
```

### Copy file contents
```bash
xclip -selection clipboard < file.txt
```

### Copy command output
```bash
ls -la | xclip -selection clipboard
```

## X11 (xsel) -- alternative

```bash
# Read
xsel --clipboard --output

# Write
echo "text" | xsel --clipboard --input

# Clear
xsel --clipboard --delete
```

## Wayland (wl-clipboard)

### Install
```bash
# Debian/Ubuntu
sudo apt install wl-clipboard

# Arch
sudo pacman -S wl-clipboard

# Fedora
sudo dnf install wl-clipboard
```

### Read clipboard
```bash
wl-paste
```

### Write to clipboard
```bash
echo "text to copy" | wl-copy
```

### Copy file contents
```bash
wl-copy < file.txt
```

## Detect display server
```bash
echo $XDG_SESSION_TYPE
# Returns: x11, wayland, or tty
```

On headless/SSH systems, clipboard tools require a display server. Use files or pipes for data transfer instead.
