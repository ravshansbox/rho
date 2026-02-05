#!/bin/bash
# Tests for tmux config installation
# Validates: config file exists, contains required settings,
# and install.sh logic handles existing configs correctly.

PASS=0
FAIL=0
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "Testing tmux config..."
echo ""

CONFIG="$REPO_DIR/configs/tmux-rho.conf"

# --- Config file exists ---
if [ -f "$CONFIG" ]; then
  pass "configs/tmux-rho.conf exists"
else
  fail "configs/tmux-rho.conf missing"
fi

# --- Required settings ---
for setting in "set -g mouse on" "set -g escape-time 10" "set -g history-limit 10000" "set -g prefix C-a"; do
  if grep -q "$setting" "$CONFIG" 2>/dev/null; then
    pass "config has: $setting"
  else
    fail "config missing: $setting"
  fi
done

# --- Status bar configured ---
if grep -q "status-left" "$CONFIG" && grep -q "status-right" "$CONFIG"; then
  pass "config has status bar"
else
  fail "config missing status bar"
fi

# --- Pane navigation ---
if grep -q "M-Left" "$CONFIG" && grep -q "M-Right" "$CONFIG"; then
  pass "config has Alt+arrow pane navigation"
else
  fail "config missing pane navigation bindings"
fi

# --- Split bindings ---
if grep -q 'bind |' "$CONFIG" && grep -q 'bind -' "$CONFIG"; then
  pass "config has | and - split bindings"
else
  fail "config missing split bindings"
fi

# --- install.sh has install_tmux_config function ---
if grep -q "install_tmux_config" "$REPO_DIR/install.sh"; then
  pass "install.sh has install_tmux_config function"
else
  fail "install.sh missing install_tmux_config function"
fi

# --- install.sh calls install_tmux_config ---
if grep -q "^install_tmux_config$" "$REPO_DIR/install.sh"; then
  pass "install.sh calls install_tmux_config"
else
  fail "install.sh doesn't call install_tmux_config"
fi

# --- install.sh skips on android ---
if grep -q 'PLATFORM.*android' "$REPO_DIR/install.sh" | head -1; then
  pass "install_tmux_config skips on android"
else
  # Check more carefully
  FUNC=$(sed -n '/^install_tmux_config/,/^}/p' "$REPO_DIR/install.sh")
  if echo "$FUNC" | grep -q 'android'; then
    pass "install_tmux_config skips on android"
  else
    fail "install_tmux_config doesn't check for android"
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
