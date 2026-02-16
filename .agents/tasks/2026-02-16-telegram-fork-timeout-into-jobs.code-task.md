---
status: completed
created: 2026-02-16
started: 2026-02-16
completed: 2026-02-16
owner: openclaw
---

# Task: Fork timed-out Telegram prompts into durable /jobs without long-task timeouts

## Description
Implement a fork-on-timeout job flow for Telegram prompts so long-horizon tasks are never hard-failed by background timeouts. When a foreground prompt exceeds the soft timeout, fork it into a durable job session, keep the main chat session responsive, and expose job lifecycle controls via `/jobs`, `/job <id>`, and `/cancel <id>`.

## Background
Current Telegram behavior defers timed-out prompts to a background queue, but active work is still effectively serialized by chat session and can make Telegram feel unresponsive when a long background run hangs. We want a model where timeout is used only to detect “likely long-running” work, then branch it into a managed job that can continue as long as needed while user follow-ups stay responsive.

## Reference Documentation
**Required:**
- Design: docs/telegram.md

**Additional References (if relevant to this task):**
- docs/slash-command-contract.md
- extensions/telegram/worker-runtime.ts
- extensions/telegram/rpc.ts
- extensions/telegram/session-map.ts
- tests/test-telegram-worker-runtime.ts
- tests/test-telegram.ts

**Note:** You MUST read the detailed design document before beginning implementation. Read additional references as needed for context.

## Technical Requirements
1. Add a durable Telegram jobs store (e.g., `~/.rho/telegram/jobs.json`) with schema for job id, chat metadata, status, prompt, job session file, timestamps, and terminal outcome.
2. On foreground RPC timeout, fork processing into a job:
   - preserve current conversation context in a job session branch,
   - rotate main chat mapping to a fresh session for subsequent non-job messages,
   - enqueue/start the job asynchronously.
3. Remove hard background timeout behavior for long-horizon jobs (support unlimited runtime or explicit `0 = no timeout` semantics).
4. Ensure active-work gating is keyed by job/session execution identity (job id or session file), not solely by chat session key, so new messages are not blocked by running jobs.
5. Add Telegram command handling for:
   - `/jobs` (list active/recent jobs),
   - `/job <id>` (show job status/details),
   - `/cancel <id>` (terminate running job and mark cancelled).
6. Emit clear in-thread lifecycle messages:
   - immediate fork acknowledgement with job id,
   - optional progress heartbeat,
   - completion/failure/cancel result message.
7. Make job execution crash-safe across worker restarts (re-hydrate in-progress jobs, avoid duplicate completion sends).
8. Extend operator/tool visibility (status snapshot and logs) to include job counts and key events.
9. Add or update tests to cover forking, session rotation, job commands, cancellation, restart recovery, and non-blocking follow-up prompts.
10. Keep existing slash-command contract behavior intact for classification and unsupported-command errors.

## Dependencies
- Existing Telegram worker runtime queue/polling flow in `extensions/telegram/worker-runtime.ts`
- RPC runner lifecycle management in `extensions/telegram/rpc.ts`
- Session mapping utilities in `extensions/telegram/session-map.ts`
- Telegram docs and command UX expectations in `docs/telegram.md`
- Existing test harnesses for Telegram runtime and RPC behavior

## Implementation Approach
1. Introduce a typed job model and persistence helpers (load/save/update/rehydrate) in Telegram extension code.
2. Refactor timeout handling path in worker runtime from “background queue defer” to “fork to job + rotate chat session mapping”.
3. Add a dedicated job execution pump with explicit state transitions (`queued -> running -> completed|failed|cancelled`) and process control hooks for cancellation.
4. Implement `/jobs`, `/job`, `/cancel` command parsing/execution and user-facing status rendering.
5. Update snapshot/log/status outputs to include job telemetry.
6. Add regression tests (unit/integration-style) and documentation updates for new behavior and configuration semantics.

## Acceptance Criteria

1. **Timeout Forks Into Job**
   - Given a Telegram prompt that exceeds `rpc_prompt_timeout_seconds`
   - When the foreground RPC call times out
   - Then the worker creates a durable job record, acknowledges with a job id, and continues execution in the job path without hard-failing due to background timeout

2. **Main Chat Remains Responsive**
   - Given a running long-horizon job for a chat
   - When the user sends a new non-job message
   - Then the message is processed in the rotated main session without waiting for job completion

3. **Job Session Branching Is Durable**
   - Given a timed-out prompt that is forked
   - When session files and maps are inspected
   - Then the job runs on a branch session while the chat mapping points to a new main session for future messages

4. **Job Commands Work End-to-End**
   - Given active and completed jobs
   - When the user sends `/jobs` or `/job <id>`
   - Then Telegram returns accurate job state, timestamps, and result metadata

5. **Cancellation Works**
   - Given a running job
   - When the user sends `/cancel <id>`
   - Then the job process is terminated, state becomes `cancelled`, and a cancellation result message is sent

6. **Restart Recovery Is Safe**
   - Given one or more queued/running jobs and a worker restart
   - When the worker boots and rehydrates state
   - Then jobs recover correctly without duplicate final messages or lost job records

7. **Contract Compatibility Preserved**
   - Given slash and non-slash inputs under Telegram RPC contract
   - When classification/execution paths run
   - Then existing slash-command validation and error mapping behavior remains unchanged

8. **Unit Test Coverage Included**
   - Given the new jobs/forking implementation
   - When Telegram test suites run
   - Then tests cover fork-on-timeout, non-blocking follow-ups, command surface, cancellation, and restart rehydration with passing results

## Metadata
- **Complexity**: High
- **Labels**: Telegram, Long-Running Tasks, Job Queue, Session Management, Reliability
- **Required Skills**: TypeScript, Node child process lifecycle control, queue/state-machine design, Telegram bot integration, test-driven refactoring