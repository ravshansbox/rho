---
name: clipboard
description: Read or write the macOS clipboard. Use when copying/pasting text, transferring data between apps, or accessing clipboard contents.
---

# Clipboard Operations

## Read clipboard
```bash
pbpaste
```

## Write to clipboard
```bash
echo "text to copy" | pbcopy
```

## Copy file contents
```bash
pbcopy < file.txt
```

## Copy command output
```bash
ls -la | pbcopy
```

Returns the clipboard contents as plain text. Binary/image data is not supported via these commands.
