---
name: tts
description: Text-to-speech on macOS -- make the device speak text aloud. Use for voice announcements, reading content aloud, or accessibility.
---

# Text-to-Speech

## Speak text
```bash
say "Hello, this is a test"
```

## Pipe text
```bash
echo "Hello world" | say
```

## Choose a voice
```bash
say -v Alex "Hello"
say -v Samantha "Hello"
say -v Daniel "Hello"
```

## List available voices
```bash
say -v '?'
```

## Adjust rate (words per minute)
```bash
say -r 200 "Speaking faster"
say -r 100 "Speaking slower"
```

## Save to audio file
```bash
say -o output.aiff "Text to save"
say -o output.aiff --data-format=LEF32@22050 "Text to save"
```

Command blocks until speech completes.
