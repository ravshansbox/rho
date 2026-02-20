# Implementation Plan: rho-web Mobile-First Multi-Session POC

## Checklist

- [ ] Step 1: Introduce per-session frontend state model without breaking current chat behavior
- [ ] Step 2: Implement session-keyed WebSocket event routing and focused/background execution paths
- [ ] Step 3: Refactor session activation/focus UX to mobile-first list → focused chat flow
- [ ] Step 4: Enable true concurrent prompting across sessions with per-session command tracking
- [ ] Step 5: Add milestone-based unread badges and required session ordering
- [ ] Step 6: Implement restore persistence (active sessions + focus + drafts) with partial-failure recovery
- [ ] Step 7: Harden reconnect/replay correctness per session
- [ ] Step 8: Add optional backend observability API for active RPC sessions (if needed)
- [ ] Step 9: Build Playwriter E2E gates for reload restore, no cross-talk, and background continuity
- [ ] Step 10: Final hardening, cleanup, and POC signoff
- [ ] Step 11: Fix review inbox clearing so received/submitted items do not linger in Web UI

---

## Step 1: Introduce per-session frontend state model without breaking current chat behavior

**Objective**
Create `SessionUiState` and `sessionStateById` structures, while preserving existing single-session behavior behind a compatibility layer.

**Implementation guidance**
- Add session state factory (`createSessionUiState(sessionId, meta)`), migrate current singleton runtime fields into this object.
- Keep global UI fields global (theme, nav, ws connection state).
- Add helper selectors: `getFocusedSessionState()`, `ensureSessionState(sessionId)`.
- Initially map old behavior to focused session only so the app remains functional at each commit.

**Test requirements**
- Unit tests for state factory defaults and helper selectors.
- Ensure no regressions in existing chat flow for one session.

**Integration with previous work**
- Foundation step; no dependency.

**Demo**
- App behaves exactly as before for one session, but internal state is now session-object-based.

---

## Step 2: Implement session-keyed WebSocket event routing and focused/background execution paths

**Objective**
Route all incoming RPC events by `payload.sessionId`, and separate focused rendering from background lightweight status updates.

**Implementation guidance**
- Replace active-session equality guard with session lookup/ensure by `sessionId`.
- Apply full render updates only when event is for focused session.
- For unfocused sessions, track only:
  - status (`starting/streaming/idle/error`)
  - milestone unread bit
  - last activity timestamps
- Keep event drop strict for malformed/missing `sessionId`.

**Test requirements**
- Integration test with interleaved events for two sessions.
- Assert no transcript mutation in wrong session.

**Integration with previous work**
- Uses Step 1 session state model.

**Demo**
- With two running sessions, focused session renders live; background session updates status only.

---

## Step 3: Refactor session activation/focus UX to mobile-first list → focused chat flow

**Objective**
Implement stable mobile-first interaction model: session list as home, focused thread as primary chat view, no runtime resets on focus change.

**Implementation guidance**
- Update `selectSession` to switch focus pointer instead of clearing global runtime.
- Keep existing sessions panel/list but make focus switching preserve background session state.
- Ensure tapping historical session auto-starts RPC and opens live chat.
- Preserve responsive desktop sidebar adaptation (same model, different layout).

**Test requirements**
- UI interaction test: switching between 2+ sessions does not clear drafts or runtime state.

**Integration with previous work**
- Depends on Step 2 routing behavior.

**Demo**
- User can jump between A and B; each retains its own transcript/draft/runtime.

---

## Step 4: Enable true concurrent prompting across sessions with per-session command tracking

**Objective**
Allow simultaneous prompts in different sessions, with isolated pending command replay and response handling.

**Implementation guidance**
- Move `pendingRpcCommands`, `isSendingPrompt`, `streamMessageId`, and queue behavior to per-session state.
- Remove global implicit lock that blocks all sessions when one is sending.
- Ensure command IDs are still globally unique, but replay bookkeeping is session-scoped.
- Ensure prompt send path always binds command to intended session id/file.

**Test requirements**
- Integration test: concurrent prompt A + prompt B, both complete independently.
- Assert no response/event crossover.

**Integration with previous work**
- Builds directly on session-keyed routing.

**Demo**
- Start prompt in A, switch to B and start another prompt; both proceed concurrently.

---

## Step 5: Add milestone-based unread badges and required session ordering

**Objective**
Implement low-noise status signaling and list ordering rules defined in requirements.

**Implementation guidance**
- Set unread only on background session milestones:
  - `agent_end`
  - `rpc_error` / `rpc_process_crashed`
- Clear unread when session is focused and successfully resynced.
- Ordering comparator:
  1. streaming
  2. active non-streaming
  3. inactive history
  then recency.

**Test requirements**
- Unit tests for unread transitions and comparator correctness.
- Integration check for row status updates during concurrent runs.

**Integration with previous work**
- Consumes status lifecycle from Step 2/4.

**Demo**
- While viewing B, A completes and shows unread badge; list sorts streaming sessions first.

---

## Step 6: Implement restore persistence (active sessions + focus + drafts) with partial-failure recovery

**Objective**
Persist and restore the required POC state through reload, including per-session drafts.

**Implementation guidance**
- Add localStorage payload `version:1`:
  - active session IDs
  - focused session ID
  - drafts map
- Debounced draft saves; immediate save on focus/active-session changes.
- On boot, restore sessions iteratively; failures should not abort global restore.
- Surface lightweight per-session error state for failed restores.

**Test requirements**
- Unit tests for serialization/deserialization and migration guards.
- Integration tests for partial restore failure (1 fail + N success).

**Integration with previous work**
- Requires stable session activation paths from Step 3.

**Demo**
- Reload with multiple active sessions restores focus + drafts; failed session restore is isolated and visible.

---

## Step 7: Harden reconnect/replay correctness per session

**Objective**
Ensure reconnection logic is fully session-aware and resilient for multi-session runtime.

**Implementation guidance**
- Track `lastEventSeq` per session.
- On reconnect, restore subscriptions and replay/resync per session.
- Handle replay gaps per session by targeted session reload, not global reset.
- Keep background sessions lightweight during catch-up.

**Test requirements**
- Integration tests with forced WS reconnect during dual-stream execution.
- Assert no duplicated or missing messages after replay.

**Integration with previous work**
- Builds on per-session command/event model from Step 4.

**Demo**
- Disconnect/reconnect during active runs; each session resumes coherently.

---

## Step 8: Add optional backend observability API for active RPC sessions (if needed)

**Objective**
Expose server-side active RPC session metadata to improve diagnostics and UI confidence.

**Implementation guidance**
- Add optional endpoint: `GET /api/rpc/sessions` returning `rpcManager.getActiveSessions()`.
- Keep endpoint read-only and lightweight.
- Use only if frontend/state debugging or acceptance gates require it.

**Test requirements**
- Route unit/integration test for response shape and error behavior.

**Integration with previous work**
- Optional; does not block core POC flow.

**Demo**
- API returns active RPC workers with ids/session files/pids/activity timestamps.

---

## Step 9: Build Playwriter E2E gates for reload restore, no cross-talk, and background continuity

**Objective**
Automate POC acceptance criteria with Playwriter as the primary E2E harness.

**Implementation guidance**
- Implement Playwriter scripts/tests for three mandatory gates:
  1. **Reload restore** with 5 active sessions and draft persistence
  2. **Concurrency integrity** (prompt A+B concurrently, no cross-talk)
  3. **Background continuity** (A runs while viewing B, badge milestone, refocus resync)
- Collect artifacts/screenshots/logs for failures.

**Test requirements**
- All three gates must be green in CI/local verification run.

**Integration with previous work**
- Validates end-to-end integration of Steps 1–8.

**Demo**
- One command executes Playwriter acceptance suite and shows all gates passing.

---

## Step 10: Final hardening, cleanup, and POC signoff

**Objective**
Stabilize and polish implementation to “rock-solid POC” quality.

**Implementation guidance**
- Remove dead single-session compatibility code.
- Confirm lint/test/format are clean with zero warnings.
- Ensure docs/comments match shipped behavior.
- Validate no excluded v1 features accidentally leaked in.

**Test requirements**
- Full project checks + Playwriter gates all green.
- Manual sanity pass on mobile viewport + desktop responsive mode.

**Integration with previous work**
- Final pass over complete feature set.

**Demo**
- End-to-end: 5 active sessions restored after reload, concurrent prompts, no cross-talk, proper milestone badges, and stable refocus resync.

---

## Step 11: Fix review inbox clearing so received/submitted items do not linger in Web UI

**Objective**
Resolve the review inbox state bug where items that were already received/submitted remain visible in the Web UI when they should clear.

**Implementation guidance**
- Reproduce the bug in the review panel flow (submitted → received/claimed/resolved path).
- Audit review list refresh triggers in frontend (`review-panel.js`) and corresponding backend responses.
- Ensure list state transitions correctly remove/move items after status changes.
- Add explicit refresh/invalidation after review actions where needed.
- Keep behavior consistent across polling and WebSocket/UI-event updates.

**Test requirements**
- Add regression coverage for the stale review inbox case.
- Verify that after receiving/processing a submitted review, the item no longer lingers in the submitted inbox view.
- Verify no regressions for open/claimed/resolved filters.

**Integration with previous work**
- Can be delivered alongside final hardening; independent of core multi-session routing.

**Demo**
- Submit/receive/process a review and show the submitted inbox clearing immediately (or on next expected refresh) without manual page reload.

---

## Connections

- [[../design/detailed-design.md]]
- [[../idea-honing.md]]
- [[../research/01-current-rho-web-multi-session-readiness.md]]
- [[../research/02-mobile-browser-runtime-constraints.md]]
- [[../research/03-v1-mobile-first-ux-and-state-model.md]]
- [[../research/04-poc-acceptance-matrix.md]]
