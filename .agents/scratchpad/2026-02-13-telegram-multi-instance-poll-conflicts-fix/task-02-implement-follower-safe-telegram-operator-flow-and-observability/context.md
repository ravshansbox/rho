# Context — task-02-implement-follower-safe-telegram-operator-flow-and-observability

## Parameter Acquisition

- `task_description`: `.agents/tasks/2026-02-13-telegram-multi-instance-poll-conflicts-fix/task-02-implement-follower-safe-telegram-operator-flow-and-observability.code-task.md`
  - resolved source file: `/home/mobrienv/.rho/.agents/tasks/2026-02-13-telegram-multi-instance-poll-conflicts-fix/task-02-implement-follower-safe-telegram-operator-flow-and-observability.code-task.md`
- `documentation_dir`: `.agents/scratchpad/{project_name}`
- `repo_root`: requested as current working directory; validated implementation repo at `/home/mobrienv/projects/rho`
- `mode`: `auto` (normalized)
- `project_name`: `2026-02-13-telegram-multi-instance-poll-conflicts-fix` (inferred)
- `task_name`: `task-02-implement-follower-safe-telegram-operator-flow-and-observability` (inferred)

> Auto mode active: no further user interaction required during execution.

## Setup + Instruction Discovery

- Documentation directory created:
  - `.agents/scratchpad/2026-02-13-telegram-multi-instance-poll-conflicts-fix/task-02-implement-follower-safe-telegram-operator-flow-and-observability/`
  - `.agents/scratchpad/2026-02-13-telegram-multi-instance-poll-conflicts-fix/task-02-implement-follower-safe-telegram-operator-flow-and-observability/logs/`
- Instruction file discovery command output:
  - `./README.md`

`CODEASSIST.md` was not found in repo root. Suggestion: add one for project-specific SOP constraints, pre/post checks, and troubleshooting standards.

## Existing Documentation (Auto-selected)

- `README.md`
  - Telegram operator controls include `/telegram status` and `/telegram check`.
  - Telegram integration is polling-first and operationally focused.
- `.agents/planning/.../design/detailed-design.md` (required)
  - Emphasizes robust operator observability and reliability under polling mode.
- `docs/telegram.md`
  - Current state files and operator controls documented; known limits mention single-runtime orientation.

## Relevant Code + Patterns

- `extensions/telegram/index.ts`
  - Leader election integrated in task 01.
  - Follower currently **skips** check instead of routing to leader.
  - Status has leadership + lock owner but lacks trigger request visibility.
- `extensions/telegram/log.ts`
  - Flexible structured JSONL logger (`event`, `schema_version`, `source`).
- `extensions/telegram/lib.ts`
  - Telegram path constants and runtime state helpers.
- `extensions/rho/index.ts`
  - Proven cross-process trigger pattern:
    - trigger file write (atomic)
    - leader consume by mtime
    - follower trigger requests return deterministic leader-aware feedback.

## Functional Requirements

1. Follower-safe semantics for `telegram(action="check")` and `/telegram check`.
2. Cross-process trigger coordination for non-leader check requests.
3. Status/UI observability must include leadership + owner + trigger/health context.
4. Standardized operational events for:
   - leadership transitions
   - follower check requests
   - leader trigger consumption
   - check execution outcomes
5. All operator actions remain safe in follower mode and must not spawn duplicate pollers.
6. Tests for follower-trigger flow, leader consumption, and status/log correctness.

## Acceptance Criteria Mapping

- **Follower Check Request Routing**: follower requests leader check instead of polling directly.
- **Leader Check Execution**: leader consumes trigger and performs check.
- **Operator Status Clarity**: role + owner + trigger context visible.
- **No Duplicate Poller Side Effects**: commands/actions do not start extra poll loops.
- **Integrated Test Coverage**: tests prove trigger routing + consume + status/log behavior.

## Dependency Map

- `extensions/telegram/index.ts`
  - will depend on a trigger coordination helper for check requests/consumption
  - will emit standardized operator/log events
- `extensions/telegram/lib.ts`
  - may add trigger file path constant
- `extensions/telegram/log.ts`
  - existing schema supports required event payloads (no schema migration required)
- `tests/test-telegram.ts`
  - extend with trigger coordination + observability-focused cases

## Implementation Paths

- Add a dedicated trigger helper module for Telegram check requests.
- Integrate request/consume flow into leadership tick + operator `check` handlers.
- Extend status output and UI status line with trigger context.
- Add tests for trigger lifecycle, routing semantics, and status formatting contracts.
