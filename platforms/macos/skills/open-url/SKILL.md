---
name: open-url
description: Open URLs, files, and applications on macOS. Use for launching browsers, opening documents, or starting apps.
---

# Open URLs and Files

## Open a URL in default browser
```bash
open https://example.com
```

## Open a file with default app
```bash
open document.pdf
open image.png
```

## Open with a specific app
```bash
open -a "Safari" https://example.com
open -a "Visual Studio Code" project/
open -a "Finder" /path/to/directory
```

## Reveal in Finder
```bash
open -R /path/to/file
```

## Open a new Finder window
```bash
open .
```
