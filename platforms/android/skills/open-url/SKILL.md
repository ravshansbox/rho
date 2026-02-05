---
name: open-url
description: Open URLs and launch apps on Android. Use for opening links in a browser, launching specific apps, or viewing files.
---

# Open URLs and Launch Apps

## Open a URL in default browser
```bash
termux-open-url https://example.com
```

## Open a URL with am start (more control)
```bash
am start -a android.intent.action.VIEW -d "https://example.com"
```

## Open a file with default handler
```bash
termux-open /path/to/file.pdf
termux-open --content-type image/png /path/to/image.png
```

## Launch an app by package name
```bash
# Using monkey (simplest, launches main activity)
/system/bin/monkey -p com.twitter.android -c android.intent.category.LAUNCHER 1

# Using am start (specify exact activity)
am start -n com.android.settings/.Settings
```

## Common app packages
| App | Package |
|-----|---------|
| Chrome | `com.android.chrome` |
| Settings | `com.android.settings` |
| Files | `com.google.android.documentsui` |
| YouTube | `com.google.android.youtube` |
| X/Twitter | `com.twitter.android` |
| Tasker | `net.dinglisch.android.taskerm` |

## Launch app with specific intent
```bash
# Open a specific URL in Chrome
am start -n com.android.chrome/com.google.android.apps.chrome.Main -d "https://example.com"

# Share text to another app
am start -a android.intent.action.SEND -t "text/plain" --es android.intent.extra.TEXT "Hello"

# Open dialer with number
am start -a android.intent.action.DIAL -d "tel:5551234567"

# Open map location
am start -a android.intent.action.VIEW -d "geo:0,0?q=coffee+shops"
```

## List installed packages
```bash
pm list packages | grep keyword
```

## Notes
- `termux-open-url` is the simplest option for URLs
- `termux-open` handles files with MIME type detection
- `am start` gives full control over intents and activities
- `monkey` (`/system/bin/monkey`) is a quick way to launch an app's main activity
- All commands work without root
