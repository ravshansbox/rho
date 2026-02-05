---
name: tts
description: Text-to-speech on Linux -- make the device speak text aloud. Use for voice announcements, reading content aloud, or accessibility.
---

# Text-to-Speech

## espeak / espeak-ng

### Install
```bash
# Debian/Ubuntu
sudo apt install espeak-ng

# Arch
sudo pacman -S espeak-ng

# Fedora
sudo dnf install espeak-ng
```

### Speak text
```bash
espeak "Hello, this is a test"
espeak-ng "Hello, this is a test"
```

### Pipe text
```bash
echo "Hello world" | espeak
cat article.txt | espeak
```

### Choose a voice/language
```bash
espeak -v en "English"
espeak -v en-us "American English"
espeak -v fr "Bonjour"
```

### List available voices
```bash
espeak --voices
espeak --voices=en   # English voices only
```

### Adjust speed (words per minute)
```bash
espeak -s 200 "Speaking faster"
espeak -s 100 "Speaking slower"
```

### Adjust pitch (0-99)
```bash
espeak -p 80 "Higher pitch"
espeak -p 20 "Lower pitch"
```

### Save to audio file
```bash
espeak -w output.wav "Text to save"
```

## speech-dispatcher (spd-say) -- alternative

```bash
# Install
sudo apt install speech-dispatcher

# Speak
spd-say "Hello world"

# Set rate (-100 to 100)
spd-say -r 50 "Faster"

# Set voice
spd-say -t female1 "Hello"

# Stop speech
spd-say -S
```

## piper -- neural TTS (higher quality)

For higher quality offline TTS, consider [piper](https://github.com/rhasspy/piper):
```bash
echo "Hello world" | piper --model en_US-lessac-medium --output_file output.wav
aplay output.wav
```

Command blocks until speech completes (espeak, spd-say). On headless systems, audio output requires ALSA or PulseAudio.
