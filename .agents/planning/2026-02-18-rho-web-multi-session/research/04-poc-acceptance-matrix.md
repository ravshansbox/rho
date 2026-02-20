# Research: Rock-Solid POC Acceptance Matrix

## Scope

Translate agreed acceptance criteria into concrete pass/fail checks and verification flows for implementation.

## Baseline Success Criteria (from requirements)

1. Restore after reload with active multi-session context.
2. Concurrent streams without cross-talk.
3. Background continuity + correct resync on refocus.
4. Validate with **5 simultaneously active sessions**.

## Acceptance Matrix

| ID | Scenario | Pass Condition | Fail Condition |
|---|---|---|---|
| A1 | Reload restore with 5 active sessions | After full reload, 5 sessions are reactivated; focused session restored; per-session drafts restored; failures isolated per-session | Any global restore abort, wrong focus restoration, draft loss without failure indicator |
| A2 | Concurrent prompt execution | Prompts can be sent in 2+ sessions concurrently; each session receives only its own stream/events/messages | Event or message appears in wrong session; global lock blocks concurrent prompts |
| A3 | Background continuity | Session A keeps running while user focuses B; status badge updates on A milestones (`agent_end`/error) | A pauses unexpectedly, loses progress, or no milestone status update |
| A4 | Refocus resync correctness | On returning to A, client reloads session data + syncs `get_state`; transcript/state coherent | Missing messages, duplicated stream state, stale status after refocus |
| A5 | Error isolation | One session restore/start failure does not block others; failed session gets lightweight error state | One failure breaks whole restore/process |

## Verification Sequence (high level)

```mermaid
sequenceDiagram
    participant U as User
    participant UI as rho-web UI
    participant WS as /ws
    participant RPCA as RPC Session A
    participant RPCB as RPC Session B

    U->>UI: Send prompt in A
    UI->>WS: rpc_command(sessionId=A)
    WS->>RPCA: prompt

    U->>UI: Switch to B and send prompt
    UI->>WS: rpc_command(sessionId=B)
    WS->>RPCB: prompt

    RPCA-->>WS: rpc_event(sessionId=A,...)
    RPCB-->>WS: rpc_event(sessionId=B,...)
    WS-->>UI: interleaved rpc_event frames

    Note over UI: Route by sessionId
    Note over UI: Render focused only; background milestone status only

    U->>UI: Reload page
    UI->>UI: restore active IDs + focus + drafts
    UI->>WS: re-subscribe / restart sessions
    UI->>WS: get_state per active session
```

## Suggested Test Layers

- **Unit**
  - per-session reducer/state updates by `sessionId`
  - unread milestone transitions
  - localStorage serialization/deserialization + partial failure handling
- **Integration**
  - WS event routing for two sessions interleaving events
  - reconnect/replay logic with per-session sequence tracking
- **Manual/E2E (Playwright/Playwriter)**
  - 5-session restore drill
  - cross-talk stress run (concurrent prompts)
  - focus-switch during active stream

## Notes

- “No hard cap” is accepted for v1, but metrics/logging for active process count should be included to aid debugging.
- Keep tests strict about message/session identity to prevent subtle routing regressions.

## Connections

- [[../idea-honing.md]]
- [[01-current-rho-web-multi-session-readiness.md]]
- [[02-mobile-browser-runtime-constraints.md]]
- [[03-v1-mobile-first-ux-and-state-model.md]]
- [[session-health-monitor-inspiration]]
- [[agent-observability]]
