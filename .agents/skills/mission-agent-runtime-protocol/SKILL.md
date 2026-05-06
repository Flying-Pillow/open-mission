---
name: mission-agent-runtime-protocol
description: Emit strict Mission protocol markers for task-scoped Agent execution progress, input requests, blockers, and completion claims.
---

# Mission Agent Runtime Protocol

## Core rule

Mission state is owned by the daemon and repository. Your claims are advisory signals only.

- A protocol marker does **not** prove deterministic verification success.
- `ready_for_verification` means "ready for Mission/operator verification," not "verified."
- `completed_claim` means "I believe the task is complete," not "Mission marked it complete."

## Required path: strict Mission protocol markers

Emit a single-line stdout marker with this exact prefix:

```text
mission::
```

The prefix must be immediately followed by strict JSON on the same line. The JSON shape is:

```json
{
  "version": 1,
  "missionId": "<mission-id>",
  "taskId": "<task-id>",
  "agentExecutionId": "<agent-execution-id>",
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

Protocol markers are agent-declared claims and always require Mission signal-policy evaluation.

## Behavioral rules

1. Use the mission/task/execution ids supplied by the current launch context. Do not invent or reuse ids from another execution.
2. Use a fresh `eventId` for every distinct signal.
3. Keep markers one line, valid JSON, and session-scoped.
4. Emit markers on stdout, not stderr.
5. Use normal prose for explanation if helpful, but do not replace protocol markers with prose alone when reporting structured state.
