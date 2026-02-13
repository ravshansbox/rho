# Plan — task-01-implement-telegram-poll-leader-election

## Test Strategy

Design principle: validate lease-driven role transitions independently and ensure polling is leader-gated by runtime state.

### Scenario 1 — Single active leader among two contenders
- **Setup**: two leadership states, shared `poll.lock.json`, unique nonces.
- **Input**: both attempt election at same timestamp.
- **Expected output**:
  - exactly one contender becomes leader
  - other remains follower
  - lock file exists and points to one owner
- **Acceptance criteria covered**: Single Active Poller, Follower Safety.

### Scenario 2 — Follower does not take leadership while lease is healthy
- **Setup**: leader acquired lock and refreshes normally.
- **Input**: follower election ticks while lock is fresh.
- **Expected output**:
  - follower remains follower on each tick
  - no dual-leader state emerges
- **Acceptance criteria covered**: Follower Safety, Conflict Elimination.

### Scenario 3 — Handover after leader release
- **Setup**: leader + follower sharing same lock path.
- **Input**: leader releases lease (simulated shutdown), follower ticks election.
- **Expected output**:
  - follower becomes leader
  - new lease is active
- **Acceptance criteria covered**: Leadership Handover.

### Scenario 4 — Stale takeover after orphan lock
- **Setup**: stale/orphan payload in lock path (dead pid + old timestamp).
- **Input**: follower election tick.
- **Expected output**:
  - stale lock is replaced
  - follower acquires leadership
- **Acceptance criteria covered**: Leadership Handover.

## Implementation Plan

1. Add telegram poll lock path constants in `extensions/telegram/lib.ts`.
2. Add a telegram poll leadership helper module wrapping lease-lock semantics.
3. Integrate leadership runtime fields + lifecycle in `extensions/telegram/index.ts`:
   - leader/follower tracking
   - leader-only poll scheduling
   - refresh/demotion/takeover loop
   - shutdown-safe release
4. Update telegram status output + status line to expose leadership/owner context.
5. Add tests in `tests/test-telegram.ts` for election + takeover behavior.
6. Run RED (new tests fail), then GREEN (implementation passes), then REFACTOR validation.
7. Run targeted test/build commands and capture logs under `logs/`.
8. Commit with Conventional Commit message.

## Implemented Test Outline (RED stage)

- File updated: `tests/test-telegram.ts`
- Added new section: `poll leadership election + takeover`
- New assertions validate:
  - only one leader wins initial election
  - follower remains follower while leader refreshes
  - follower takes over after leader release
  - stale lock takeover works
- RED execution command:
  - `npx -y tsx tests/test-telegram.ts > .../logs/test-telegram-red.log 2>&1`
- RED result:
  - expected failure (`ERR_MODULE_NOT_FOUND`) for missing `extensions/telegram/poll-leadership.ts`

## Implementation Progress Notes

Completed:
- Added new helper module: `extensions/telegram/poll-leadership.ts`
- Added poll lock path constant: `extensions/telegram/lib.ts`
- Updated telegram extension runtime lifecycle: `extensions/telegram/index.ts`
- Added leadership tests: `tests/test-telegram.ts`

## Risks and Mitigations

- **Risk**: racey transitions may leave old poll timer alive.
  - **Mitigation**: centralize demotion path to always clear poll timer before exit.
- **Risk**: stale lock false-positives.
  - **Mitigation**: reuse existing lease-lock stale logic (`isLeaseStale`).
- **Risk**: process signal handlers causing side effects.
  - **Mitigation**: idempotent cleanup guards and minimal side-effect handlers.
