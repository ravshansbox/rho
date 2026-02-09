#!/usr/bin/env bash
# Rho — Developer install script (for local repo checkouts)
#
# End users: install via npm instead:
#   npm install -g @rhobot-dev/rho
#   rho init && rho sync
#
# This script is for developers who cloned the repo. It symlinks the
# rho CLI from this checkout, installs deps, and runs rho init + sync.
# Works from any directory -- no hardcoded paths.
#
# Usage: ./install.sh [--force]
#   --force: overwrite existing AGENTS.md
#
# Idempotent: safe to run multiple times.
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_DIR="$HOME/.pi/agent"
RHO_DIR="$HOME/.rho"
BRAIN_DIR="$RHO_DIR/brain"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
  esac
done

# --- Platform Detection ---

detect_platform() {
  if [ -n "$TERMUX_VERSION" ]; then
    PLATFORM="android"
  else
    case "$(uname -s)" in
      Darwin) PLATFORM="macos" ;;
      Linux)  PLATFORM="linux" ;;
      *)
        echo "Error: Unsupported OS: $(uname -s)"
        exit 1
        ;;
    esac
  fi
  echo "Detected platform: $PLATFORM"
}

# --- Dependency Checks ---

check_dependencies() {
  local missing=0

  for cmd in node npm tmux git; do
    if ! command -v "$cmd" &>/dev/null; then
      missing=1
      case "$PLATFORM" in
        android)
          echo "⚠ $cmd not found. Installing via pkg..."
          pkg install -y "$cmd" 2>/dev/null || {
            echo "Error: Failed to install $cmd via pkg"
            exit 1
          }
          ;;
        macos)
          case "$cmd" in
            node|npm) echo "⚠ $cmd not found. Install with: brew install node" ;;
            tmux)     echo "⚠ $cmd not found. Install with: brew install tmux" ;;
            git)      echo "⚠ $cmd not found. Install with: brew install git (or xcode-select --install)" ;;
          esac
          ;;
        linux)
          local pkg_hint=""
          if [ -f /etc/NIXOS ] || command -v nixos-rebuild &>/dev/null; then
            case "$cmd" in
              node|npm) pkg_hint="Add nodejs to environment.systemPackages or use nix-shell -p nodejs" ;;
              *)        pkg_hint="Add $cmd to environment.systemPackages or use nix-shell -p $cmd" ;;
            esac
          elif command -v apt &>/dev/null; then
            case "$cmd" in
              node|npm) pkg_hint="sudo apt install nodejs npm" ;;
              *)        pkg_hint="sudo apt install $cmd" ;;
            esac
          elif command -v pacman &>/dev/null; then
            case "$cmd" in
              node|npm) pkg_hint="sudo pacman -S nodejs npm" ;;
              *)        pkg_hint="sudo pacman -S $cmd" ;;
            esac
          elif command -v dnf &>/dev/null; then
            case "$cmd" in
              node|npm) pkg_hint="sudo dnf install nodejs npm" ;;
              *)        pkg_hint="sudo dnf install $cmd" ;;
            esac
          else
            pkg_hint="Install $cmd using your package manager"
          fi
          echo "⚠ $cmd not found. Install with: $pkg_hint"
          ;;
      esac
    fi
  done

  # pi is required for rho to run. Install it automatically if missing.
  if ! command -v pi &>/dev/null; then
    echo "Installing pi coding agent..."
    npm install -g @mariozechner/pi-coding-agent
  fi

  # On desktop, exit if anything was missing (we printed instructions above)
  if [ "$missing" -eq 1 ] && [ "$PLATFORM" != "android" ]; then
    echo ""
    echo "Install missing dependencies and re-run ./install.sh"
    exit 1
  fi
}

# --- Node dependencies (for local-path package installs) ---

install_node_deps() {
  echo "Installing Node dependencies..."
  (cd "$REPO_DIR" && npm install)
}

# --- Cleanup ---

cleanup_old() {
  echo "Cleaning up old symlinks..."

  # Extensions: handle both old-style (directory symlink) and new-style (individual file symlinks)
  if [ -L "$PI_DIR/extensions" ]; then
    # Old install: extensions/ is a symlink to repo dir. Remove the symlink only.
    rm -f "$PI_DIR/extensions"
  elif [ -d "$PI_DIR/extensions" ]; then
    # New install: extensions/ is a real dir with individual symlinks. Remove symlinks inside.
    find "$PI_DIR/extensions" -maxdepth 1 -type l -delete 2>/dev/null || true
    rm -f "$PI_DIR/extensions"/*.ts 2>/dev/null || true
  fi

  # Skills: handle both old-style (directory symlink) and new-style (individual dir symlinks)
  if [ -L "$PI_DIR/skills" ]; then
    # Old install: skills/ is a symlink to repo dir. Remove the symlink only.
    rm -f "$PI_DIR/skills"
  elif [ -d "$PI_DIR/skills" ]; then
    # New install: skills/ is a real dir with individual symlinks.
    # Use find to catch broken symlinks too (glob */ skips them).
    # IMPORTANT: use -L check and rm -f (not rm -rf) for symlinks,
    # otherwise rm -rf follows the symlink and deletes actual repo files.
    find "$PI_DIR/skills" -maxdepth 1 -type l -delete 2>/dev/null || true
    for entry in "$PI_DIR/skills"/*/; do
      [ -d "$entry" ] || continue
      rm -rf "$entry"
    done
  fi
}

# --- Install Extensions ---
# NOTE: Platform extensions are now installed by `rho init`.
# Core extensions are loaded via pi package entry (settings.json).

# --- Install Skills ---
# NOTE: Platform skills are now installed by `rho init`.
# Core skills are loaded via pi package entry (settings.json).

# --- Install CLI launcher ---

install_cli() {
  # Determine BIN_DIR
  if [ -n "$PREFIX" ] && [ -d "$PREFIX/bin" ]; then
    BIN_DIR="$PREFIX/bin"
  else
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
  fi

  # Clean break: remove legacy wrapper symlinks if present.
  for name in rho-daemon rho-status rho-stop rho-trigger rho-login; do
    if [ -L "$BIN_DIR/$name" ]; then
      rm -f "$BIN_DIR/$name" || true
    fi
  done

  # Install `rho` on PATH by symlinking directly to the Node CLI.
  # No extra config file indirection.
  chmod +x "$REPO_DIR/cli/index.ts" 2>/dev/null || true
  ln -sf "$REPO_DIR/cli/index.ts" "$BIN_DIR/rho"
  echo "✓ Installed rho -> $BIN_DIR/rho"

  # Platform-specific scripts
  if [ "$PLATFORM" = "android" ]; then
    local stt_dir="$REPO_DIR/platforms/android/scripts/bin"
    if [ -d "$stt_dir" ]; then
      local stt_bin="$HOME/bin"
      mkdir -p "$stt_bin"
      for script in "$stt_dir"/stt "$stt_dir"/stt-send; do
        [ -f "$script" ] || continue
        chmod +x "$script"
        ln -sf "$script" "$stt_bin/$(basename "$script")"
      done
      echo "✓ Installed STT scripts -> $stt_bin"
    fi
  fi

  # Warn about PATH on non-Termux
  if [ "$PLATFORM" != "android" ]; then
    case ":$PATH:" in
      *":$BIN_DIR:"*) ;;
      *)
        echo ""
        echo "⚠ $BIN_DIR is not in your PATH. Add to your shell profile:"
        echo "  export PATH=\"$BIN_DIR:\$PATH\""
        echo ""
        ;;
    esac
  fi
}

# --- Bootstrap Templates, Brain, Tmux Config ---
# NOTE: All bootstrapping (AGENTS.md, RHO.md, HEARTBEAT.md, brain defaults,
# tmux config, platform skills/extensions) is now handled by `rho init`.
# install.sh just calls `rho init` in bootstrap_rho_config below.

# --- Bootstrap Doom-style config ---

bootstrap_rho_config() {
  echo ""
  echo "Bootstrapping config..."

  # rho init handles everything: config files, templates, brain defaults,
  # tmux config, and platform skills/extensions.
  local init_args="--name rho"
  if [ "$FORCE" -eq 1 ]; then
    init_args="$init_args --force"
  fi
  node --experimental-strip-types "$REPO_DIR/cli/index.ts" init $init_args

  echo ""
  echo "Syncing config..."
  # Sync using the local repo path as the package source.
  RHO_SOURCE="$REPO_DIR" node --experimental-strip-types "$REPO_DIR/cli/index.ts" sync
}

# --- Platform Setup ---

run_platform_setup() {
  local setup="$REPO_DIR/platforms/$PLATFORM/setup.sh"
  if [ -f "$setup" ]; then
    echo ""
    chmod +x "$setup"
    bash "$setup"
  fi
}

# --- Main ---

echo "Installing Rho..."
echo ""

detect_platform
check_dependencies
install_node_deps
cleanup_old
install_cli
bootstrap_rho_config
run_platform_setup

echo ""
echo "Done! Platform: $PLATFORM"
echo ""
echo "Next steps:"
echo "  1. Authenticate: rho login"
echo "  2. Check health: rho doctor"
echo "  3. Start: rho"
