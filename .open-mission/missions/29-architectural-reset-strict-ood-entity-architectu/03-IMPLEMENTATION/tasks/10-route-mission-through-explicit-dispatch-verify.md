---
taskKind: "verification"
pairedTaskId: "implementation/10-route-mission-through-explicit-dispatch"
dependsOn: ["implementation/10-route-mission-through-explicit-dispatch"]
agent: "copilot-cli"
---

# Verify Mission Explicit Dispatch

Paired task: `implementation/10-route-mission-through-explicit-dispatch`.

Focused checks: daemon dispatch has explicit Mission query and command handlers, payload/result parsing is method-specific, missing context and unknown methods fail loudly, command results parse as acknowledgements or source-local results, and `PROTOCOL_VERSION` is bumped when daemon RPC behavior changes.

Failure signals: dispatcher calls arbitrary Mission methods by string lookup, accepts broad Mission runtime snapshots as command results, skips result parsing, or leaves Mission out of generic entity dispatch tests.

Ignore: Airport client still using old route fetches. That is the next task.

Evidence: append dispatch test output, protocol-version evidence, and static handler coverage to `03-IMPLEMENTATION/VERIFY.md`.
