# Context — task-01-implement-telegram-poll-leader-election

## Parameter Acquisition

- `task_description`: resolved from `.rho` task file
  - Source: `/home/mobrienv/.rho/.agents/tasks/2026-02-13-telegram-multi-instance-poll-conflicts-fix/task-01-implement-telegram-poll-leader-election.code-task.md`
- `additional_context`: `m` (no extra constraints found)
- `documentation_dir`: `.agents/scratchpad/{project_name}`
- `repo_root`: **resolved to** `/home/mobrienv/projects/rho` (the code referenced by the task lives here)
- `mode`: `auto` (normalized)
- `project_name`: `2026-02-13-telegram-multi-instance-poll-conflicts-fix` (inferred from task path)
- `task_name`: `task-01-implement-telegram-poll-leader-election` (inferred from task filename)

> Auto mode is active: implementation proceeds without further prompts.

## Existing Documentation

Instruction file discovery command output:
- `./README.md`

Files reviewed:
- `/home/mobrienv/projects/rho/README.md`
  - Telegram adapter is polling-first via `getUpdates`
  - Operator controls exposed via `/telegram` and `telegram` tool
- `/home/mobrienv/projects/rho/docs/telegram.md`
  - State files under `~/.rho/telegram/`
  - Current model is single-runtime-oriented and polling-only
- `/home/mobrienv/.rho/.agents/planning/2026-02-13-telegram-support-rho/design/detailed-design.md`
  - Polling transport with durable state and reliability goals
  - Emphasis on safe routing and operational robustness

`CODEASSIST.md` was not found in `/home/mobrienv/projects/rho`. If this SOP is reused, adding one would help enforce project-specific build/test/edge-case rules.

## Relevant Code Paths

- `extensions/telegram/index.ts`
  - Poll loop lifecycle, queueing, tool/command handlers, status rendering
- `extensions/telegram/lib.ts`
  - Telegram filesystem paths, settings/state load/save helpers
- `extensions/lib/lease-lock.ts`
  - Shared lease lock primitives (atomic acquire, refresh, stale takeover, safe release)
- `extensions/rho/index.ts`
  - Existing heartbeat leader-election pattern used as implementation reference
- `tests/test-telegram.ts`
  - Existing telegram helper/integration-style unit tests
- `tests/test-lease-lock.ts`
  - Existing lease lock behavior tests

## Functional Requirements (from task)

1. Add Telegram leader election so only one process polls `getUpdates`.
2. Use dedicated lock file under `~/.rho/telegram/` (e.g., `poll.lock.json`).
3. Schedule poll timers for leaders only.
4. Handle leader loss, stale takeover, and shutdown cleanup safely.
5. Surface leader/follower role + lock owner details in status output.
6. Add tests covering leader-only polling, follower safety, and takeover.

## Acceptance Criteria Mapping

- **Single Active Poller**: two runtime contenders -> exactly one leader polls.
- **Conflict Elimination**: no local duplicate pollers during normal operation.
- **Leadership Handover**: follower takes over after leader loss/stale lock.
- **Follower Safety**: follower never executes polling path.
- **Integrated Coverage**: tests added and passing for all above behaviors.

## Dependency Map

- `extensions/telegram/index.ts`
  - depends on: `TelegramClient`, router/authz, session map, RPC runner, queue/retry helpers
  - new dependency: lease lock primitives (`tryAcquireLeaseLock`, `readLeaseMeta`, `isLeaseStale`, `readLeasePayload`)
- `extensions/telegram/lib.ts`
  - provides filesystem constants and runtime state persistence
  - new: telegram poll lock path constant
- `tests/test-telegram.ts`
  - new test section for leader election state transitions and takeover semantics

## Implementation Paths

- Introduce leadership runtime state and lifecycle controls in `extensions/telegram/index.ts`.
- Add lock path constant(s) in `extensions/telegram/lib.ts`.
- Add focused leadership helper module to keep index lifecycle logic readable/testable.
- Extend `tests/test-telegram.ts` with deterministic lock-based tests.

## Non-Functional Constraints

- Keep behavior backwards-compatible for single-instance users.
- Avoid introducing duplicate timers or orphan lock ownership.
- Keep implementation simple and aligned with heartbeat lease model.
