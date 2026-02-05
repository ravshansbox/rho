# Rho Review Findings

Comprehensive review of the repo with actionable fixes. Grouped by area.

## Extensions

1. **`extensions/rho.ts` — undefined function `readRhoMd`**
   - In the `rho_control` `status` case, it calls `readRhoMd(ctx)` but that function doesn’t exist anywhere.
   - **Fix:** replace with `readMarkdownFile([...])` or add a `readRhoMd` helper that mirrors `triggerCheck`.

2. **`extensions/rho.ts` — checklist files treated as empty**
   - `readMarkdownFile()` ignores any line starting with `-`, so standard checkbox lists are considered “empty” and never included in the heartbeat prompt.
   - **Fix:** treat checklist lines (`- [ ]`, `- [x]`) as content; only skip headers/blank lines.

3. **`extensions/rho.ts` — heartbeat skip claim not implemented**
   - `RHO.md.template` says heartbeats will be skipped if the file is empty, but `triggerCheck()` always runs.
   - **Fix:** either implement a skip when both RHO/HEARTBEAT are truly empty, or remove the note from the template.

4. **`extensions/rho.ts` — “Suppress this message” comment is misleading**
   - `agent_end` detects `RHO_OK` and shows a toast, but doesn’t actually suppress the assistant message.
   - **Fix:** either remove the comment or implement actual suppression (if supported by the pi API).

5. **`extensions/brain.ts` — context matching uses `process.cwd()`**
   - `updateBrainWidget()` checks contexts with `process.cwd()` instead of `ctx.cwd`, which can mismatch when multiple sessions or when cwd changes.
   - **Fix:** use `ctx.cwd` consistently.

6. **`extensions/brain.ts` — brittle JSONL parsing**
   - `readJsonl()` throws if any line is malformed JSON, which can crash extension hooks.
   - **Fix:** wrap per-line parsing and skip bad lines with a warning.

7. **`extensions/usage-bars.ts` — interval not cleared on shutdown**
   - `setInterval` is started on `session_start` but never cleared on shutdown, so repeated sessions can stack polls.
   - **Fix:** clear the interval on `session_shutdown`.

## Scripts / Daemon

8. **`scripts/rho-trigger` — hardcoded path to `rho-daemon`**
   - Uses `~/.local/bin/rho-daemon`, which is wrong for Termux installs where scripts live in `$PREFIX/bin`.
   - **Fix:** call `rho-daemon` from `PATH`.

9. **`scripts/rho-daemon` — notification actions likely broken**
   - Uses `termux-tmux` (not a real command) and relies on `$PATH` in notification actions, which run in a stripped env.
   - **Fix:** use absolute tmux path or wrap with `sh -lc` and set `--id` so it can be removed.

10. **`scripts/rho` vs `rho-stop` — inconsistent notification IDs**
   - `rho` uses `--id rho-status`, while `rho-stop` removes `rho-daemon`. Notifications won’t get cleared reliably.
   - **Fix:** standardize on a single ID and update both scripts.

## Packaging / Installation

11. **`manifest.json` — missing files in package**
   - Does not include `HEARTBEAT.md.template`, `SOUL.md.template`, `tasker/Rho.prj.xml`, `docs/`, or `scripts/bin/*`.
   - **Fix:** add these to the manifest so apt installs are complete.

12. **`postinst` — incomplete AGENTS template substitution**
   - Only replaces `OS`, `ARCH`, `SHELL`, `HOME`. Leaves `CONFIG_PATH`, `BRAIN_PATH`, `SKILLS_PATH` unresolved.
   - **Fix:** match `install.sh` substitutions so AGENTS.md is fully populated.

13. **`postinst` — missing HEARTBEAT/SOUL bootstrap**
   - Does not create `HEARTBEAT.md` or `SOUL.md`, even though AGENTS.md instructs to read SOUL and rho uses heartbeat.
   - **Fix:** copy templates on install like `install.sh` does.

14. **`install.sh` — STT scripts not installed**
   - `scripts/bin/stt` and `stt-send` exist but are never linked or copied. Docs and Termux keybinding expect `~/bin/stt-send`.
   - **Fix:** install/symlink these into `$PREFIX/bin` or `~/bin`, or update docs.

## Documentation mismatches

15. **`RHO.md.template` bootstrap section is outdated**
   - It instructs users to copy `AGENTS.md.template` manually, but `install.sh` already generates `~/AGENTS.md`.
   - **Fix:** update the template to reflect current install flow.

16. **`docs/termux-config.md` assumes scripts that aren’t installed**
   - References `~/bin/stt-send` and `~/bin/stt` but the repo doesn’t install them by default.
   - **Fix:** align docs with installation behavior or update install to place the scripts.
