---
name: open-url
description: Open URLs, files, and directories on Linux using default applications. Use for launching browsers, opening documents, or viewing files.
---

# Open URLs and Files

Uses `xdg-open` which respects default application settings from the desktop environment.

## Open a URL in default browser
```bash
xdg-open https://example.com
```

## Open a file with default app
```bash
xdg-open document.pdf
xdg-open image.png
xdg-open spreadsheet.csv
```

## Open a directory in file manager
```bash
xdg-open /path/to/directory
xdg-open .
```

## Check/set default applications
```bash
# Query default browser
xdg-settings get default-web-browser

# Set default browser
xdg-settings set default-web-browser firefox.desktop

# Query default for a MIME type
xdg-mime query default application/pdf
```

## Open with a specific app
```bash
# xdg-open always uses defaults; to pick a specific app:
firefox https://example.com
google-chrome https://example.com
code /path/to/project
```

`xdg-open` returns immediately (runs in background). On headless systems without a desktop environment, it will fail. Use `sensible-browser` as a fallback for URLs on Debian-based systems.
