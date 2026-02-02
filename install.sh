#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_DIR="$HOME/.pi/agent"
BRAIN_DIR="$HOME/.pi/brain"

echo "Installing rho configuration..."

# Create directories
mkdir -p "$PI_DIR" "$BRAIN_DIR"

# Symlink extensions and skills
rm -rf "$PI_DIR/extensions" "$PI_DIR/skills"
ln -sf "$REPO_DIR/extensions" "$PI_DIR/extensions"
ln -sf "$REPO_DIR/skills" "$PI_DIR/skills"

echo "✓ Symlinked extensions -> $PI_DIR/extensions"
echo "✓ Symlinked skills -> $PI_DIR/skills"

# Bootstrap AGENTS.md with runtime environment
if [ ! -f "$HOME/AGENTS.md" ] || [ "$1" = "--force" ]; then
  # Detect OS
  if [ -n "$TERMUX_VERSION" ]; then
    OS="Android / Termux $TERMUX_VERSION"
  elif [ -f /etc/os-release ]; then
    OS=$(grep ^PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"')
  else
    OS=$(uname -s)
  fi

  ARCH=$(uname -m)
  USER_SHELL=$(basename "$SHELL")

  sed -e "s|{{OS}}|$OS|g" \
      -e "s|{{ARCH}}|$ARCH|g" \
      -e "s|{{SHELL}}|$USER_SHELL|g" \
      -e "s|{{HOME}}|$HOME|g" \
      "$REPO_DIR/AGENTS.md.template" > "$HOME/AGENTS.md"

  echo "✓ Created ~/AGENTS.md with environment info"
else
  echo "• ~/AGENTS.md exists (use --force to overwrite)"
fi

# Bootstrap brain defaults if empty
if [ -d "$REPO_DIR/brain" ]; then
  for f in "$REPO_DIR/brain"/*.jsonl.default; do
    [ -f "$f" ] || continue
    target="$BRAIN_DIR/$(basename "${f%.default}")"
    if [ ! -f "$target" ]; then
      cp "$f" "$target"
      echo "✓ Created $(basename "$target")"
    fi
  done
fi

# Check for API keys
if [ -z "$BRAVE_API_KEY" ]; then
  echo ""
  echo "⚠ BRAVE_API_KEY not set. Add to ~/.bashrc:"
  echo '  export BRAVE_API_KEY="your-key"'
fi

echo ""
echo "Done! Run /reload in pi to load extensions."
