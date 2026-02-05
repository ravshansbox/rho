#!/bin/bash
# Tests for iPhone/Termius documentation
# Validates: docs exist, cover required topics, README links work.

PASS=0
FAIL=0
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "Testing iPhone/Termius docs..."
echo ""

# --- iPhone setup guide exists ---
IPHONE="$REPO_DIR/docs/iphone-setup.md"
if [ -f "$IPHONE" ]; then
  pass "docs/iphone-setup.md exists"
else
  fail "docs/iphone-setup.md missing"
fi

# --- iPhone guide covers required topics ---
for topic in "Termius" "Tailscale" "tmux" "rho" "reconnect" "keyboard"; do
  if grep -qi "$topic" "$IPHONE" 2>/dev/null; then
    pass "iPhone guide covers: $topic"
  else
    fail "iPhone guide missing: $topic"
  fi
done

# --- VPS guide exists ---
VPS="$REPO_DIR/docs/vps-setup.md"
if [ -f "$VPS" ]; then
  pass "docs/vps-setup.md exists"
else
  fail "docs/vps-setup.md missing"
fi

# --- VPS guide covers required topics ---
for topic in "Oracle" "Hetzner" "SSH key" "firewall" "install"; do
  if grep -qi "$topic" "$VPS" 2>/dev/null; then
    pass "VPS guide covers: $topic"
  else
    fail "VPS guide missing: $topic"
  fi
done

# --- README has iPhone section ---
README="$REPO_DIR/README.md"
if grep -q "iPhone" "$README"; then
  pass "README mentions iPhone"
else
  fail "README missing iPhone mention"
fi

# --- README links to iPhone guide ---
if grep -q "docs/iphone-setup.md" "$README"; then
  pass "README links to iphone-setup.md"
else
  fail "README missing link to iphone-setup.md"
fi

# --- README links to VPS guide ---
if grep -q "docs/vps-setup.md" "$README"; then
  pass "README links to vps-setup.md"
else
  fail "README missing link to vps-setup.md"
fi

# --- Feature spec exists ---
if [ -f "$REPO_DIR/features/iphone-termius-support.feature" ]; then
  pass "BDD feature spec exists"
else
  fail "BDD feature spec missing"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
