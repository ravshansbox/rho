# Research: V1 Mobile-First UX and State Model

## Scope

Define the minimal, KISS-friendly UX and frontend state model that satisfies requirements for parallel sessions in one browser tab.

## Requirements Anchors (from idea honing)

- Background sessions continue running when unfocused.
- No live rendering of unfocused session deltas.
- Unread is milestone-based (`agent_end`, errors), badges only.
- Auto-start RPC when opening historical session.
- Restore active sessions + focused session + per-session drafts on reload.
- Support concurrent prompts across sessions.
- Explicitly exclude split-screen, global queue UX, toasts, and process controls.

## Recommended UX Pattern (v1)

### Mobile primary flow

1. **Session List/Home**
   - Sorted: streaming first, then active non-streaming, then history.
   - Per-row status + unread badge.
2. **Focused Chat View**
   - One session rendered at a time.
   - Composer scoped to focused session draft.
3. **Switching sessions**
   - Keep background RPC running.
   - On focus: resync from disk + RPC state.

### Desktop adaptation

- Same model, with responsive sidebar + focused chat panel.
- No split-screen simultaneous chat rendering in v1.

## State Model Proposal

```js
state = {
  focusedSessionId: string | null,
  sessionsMeta: SessionSummary[],
  activeSessionOrder: string[],
  perSession: {
    [sessionId]: {
      rpcSessionId: string | null,
      rpcSessionFile: string | null,
      renderedMessages: Message[],
      isStreaming: boolean,
      isSendingPrompt: boolean,
      lastEventSeq: number,
      unreadMilestone: boolean,
      status: "streaming" | "idle" | "error" | "starting",
      draftText: string,
      pendingImages: ImageDraft[],
      error: string | null,
      // existing maps moved per-session
      pendingRpcCommands: Map,
      toolCallPartById: Map,
      usageAccountedMessageIds: Set,
      sessionStats: { tokens, cost, ... }
    }
  }
}
```

## Event Routing Model

```mermaid
flowchart TD
    WS[rpc_event(sessionId, event)] --> ROUTER{sessionId exists in perSession?}
    ROUTER -->|no| DROP[ignore or lazy-init status shell]
    ROUTER -->|yes| EVT[apply event to perSession[sessionId]]

    EVT --> FOCUS{sessionId == focusedSessionId?}
    FOCUS -->|yes| RENDER[update DOM/rendered parts]
    FOCUS -->|no| META[update milestone status/unread only]
```

## Why this is lowest-risk

- Keeps one rendered conversation in DOM at a time (mobile-safe).
- Preserves existing rich rendering pipeline for focused session.
- Avoids expensive background markdown/tool streaming rendering.
- Uses existing backend session multiplexing; mostly frontend refactor.

## Open Technical Choice

- Whether to lazy-create per-session state on first event vs explicit activation from session list.
- Recommendation: explicit activation path (deterministic and easier to debug).

## Conclusion

This model matches all v1 constraints and minimizes moving parts while enabling real parallel session execution.

## Connections

- [[../idea-honing.md]]
- [[01-current-rho-web-multi-session-readiness.md]]
- [[02-mobile-browser-runtime-constraints.md]]
- [[04-poc-acceptance-matrix.md]]
- [[session-health-monitor-inspiration]]
- [[openclaw-runtime-visibility-inspiration]]
