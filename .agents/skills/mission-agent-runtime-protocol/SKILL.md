---
name: mission-agent-runtime-protocol
description: Use Mission's local MCP signal server when the runtime provides it; otherwise emit strict Mission protocol markers as lower-confidence fallback claims.
---

# Mission Agent Runtime Protocol

## Core rule

Mission state is owned by the daemon and repository. Your claims are advisory signals only.

- A Mission MCP acknowledgement does **not** prove deterministic verification success.
- A fallback marker does **not** prove deterministic verification success.
- `ready_for_verification` means "ready for Mission/operator verification," not "verified."
- `completed_claim` means "I believe the task is complete," not "Mission marked it complete."

## Preferred path: local Mission MCP

If your runtime provides the local `mission_signal` MCP server, use it first.

If the launch context includes Mission MCP env vars, the local bridge command is:

```text
mission mcp agent-bridge
```

Use these tools for structured signaling:

1. `mission_report_progress`
2. `mission_request_operator_input`
3. `mission_report_blocked`
4. `mission_report_ready_for_verification`
5. `mission_report_completion_claim`
6. `mission_report_failure_claim`
7. `mission_append_session_note`
8. `mission_report_usage`

Every MCP tool call must include the session envelope fields:

- `missionId`
- `taskId`
- `agentSessionId`
- `eventId`

Use a fresh `eventId` for every distinct signal.

## Fallback path: strict Mission protocol markers

If the runtime does **not** provide Mission MCP, emit a single-line stdout marker with this exact prefix:

```text
MISSION_SIGNAL::
```

The prefix must be immediately followed by strict JSON on the same line. The JSON shape is:

```json
{
  "version": 1,
  "missionId": "<mission-id>",
  "taskId": "<task-id>",
  "agentSessionId": "<agent-session-id>",
  "eventId": "<unique-event-id>",
  "signal": {
    "type": "progress"
  }
}
```

Supported `signal` payloads:

1. `{"type":"progress","summary":"...","detail":"..."}` (`detail` optional)
2. `{"type":"needs_input","question":"...","suggestedResponses":["..."]}` (`suggestedResponses` optional)
3. `{"type":"blocked","reason":"..."}`
4. `{"type":"ready_for_verification","summary":"..."}`
5. `{"type":"completed_claim","summary":"..."}`
6. `{"type":"failed_claim","reason":"..."}`
7. `{"type":"message","channel":"agent|system|stdout|stderr","text":"..."}`

Fallback markers are **lower-confidence** than Mission MCP and still require Mission signal-policy evaluation.

## Behavioral rules

1. Use MCP first when available.
2. Use fallback markers only when MCP is unavailable or degraded for this session.
3. Use the mission/task/session ids supplied by the current launch context. Do not invent or reuse ids from another session.
4. Keep markers one line, valid JSON, and session-scoped.
5. Use normal prose for explanation if helpful, but do not replace MCP calls or fallback markers with prose alone when reporting structured state.
