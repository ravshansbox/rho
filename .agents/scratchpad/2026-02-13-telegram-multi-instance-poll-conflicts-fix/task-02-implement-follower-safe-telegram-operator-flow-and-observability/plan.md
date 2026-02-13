# Plan — task-02-implement-follower-safe-telegram-operator-flow-and-observability

## Test Strategy

### Scenario 1 — Follower check routes to trigger request
- **Input**: follower process issues check request metadata (`requester_pid`, `source`).
- **Expected**:
  - trigger file is written
  - request payload is parseable and includes requester metadata
  - no polling call is implied by routing path
- **Covers**: Follower Check Request Routing, No Duplicate Poller Side Effects.

### Scenario 2 — Leader consumes pending trigger once
- **Input**: trigger file exists and leader consumes with last-seen mtime baseline.
- **Expected**:
  - consume returns `triggered=true` + request metadata
  - file is removed
  - second consume without new trigger returns `triggered=false`
- **Covers**: Leader Check Execution.

### Scenario 3 — Status output includes leadership + owner + trigger context
- **Input**: status formatting snapshot with role (leader/follower), owner pid, trigger pending, poll health.
- **Expected**:
  - output includes leadership role line
  - output includes lock owner context
  - output includes trigger pending/last request context
- **Covers**: Operator Status Clarity.

### Scenario 4 — Standard log events normalize correctly
- **Input**: append events for `operator_check_requested`, `operator_check_trigger_consumed`, `operator_check_executed`.
- **Expected**:
  - events persist with normalized fields (`source`, `schema_version`, `event`)
  - payload retains route/outcome metadata
- **Covers**: Operational log standardization.

## Implemented Test Outline (RED stage)

- File updated: `tests/test-telegram.ts`
- Added sections:
  - `operator check trigger request/consume`
  - `operator status rendering includes leadership/trigger health`
  - `operator check event logging`
- RED command:
  - `npx -y tsx tests/test-telegram.ts > .../logs/test-telegram-red.log 2>&1`
- RED result:
  - expected failure due to missing helper modules (`extensions/telegram/check-trigger.ts`, `extensions/telegram/status.ts`)

## Implementation Plan

1. Add Telegram check trigger path constant and helper module for atomic request/consume/status.
2. Update telegram runtime to support follower-triggered checks:
   - follower `check` -> request trigger + deterministic response
   - leader loop consumes trigger and runs check
3. Extend status output and status line with trigger/health context.
4. Emit standardized operational events for request/consume/execute outcomes.
5. Add/extend tests in `tests/test-telegram.ts` to cover new behavior.
6. Execute RED → GREEN → REFACTOR cycles with logs captured in `logs/`.
7. Run full validation (`npm run test`, package/build check) before commit.

## Implementation Progress Notes

Completed:
- New trigger helper: `extensions/telegram/check-trigger.ts`
- New status helper: `extensions/telegram/status.ts`
- Trigger constant added: `extensions/telegram/lib.ts`
- Follower-safe check routing + leader trigger consumption integrated: `extensions/telegram/index.ts`
- Tests expanded: `tests/test-telegram.ts`

## Risks and Mitigations

- **Risk**: trigger requests lost if file writes are non-atomic.
  - **Mitigation**: atomic temp-write + rename.
- **Risk**: leader may repeatedly consume stale state.
  - **Mitigation**: mtime-based last-seen tracking and trigger file deletion after consume.
- **Risk**: status noise grows too verbose.
  - **Mitigation**: concise UI badge; detailed lines only in `status` output.
