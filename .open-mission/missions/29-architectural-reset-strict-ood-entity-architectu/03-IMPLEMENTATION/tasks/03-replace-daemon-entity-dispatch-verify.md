---
taskKind: "verification"
pairedTaskId: "implementation/03-replace-daemon-entity-dispatch"
dependsOn: ["implementation/03-replace-daemon-entity-dispatch"]
agent: "copilot-cli"
---

# Verify Explicit Daemon Entity Dispatch

Paired task: `implementation/03-replace-daemon-entity-dispatch`.

Focused checks: explicit Repository handlers for `find`, `add`, `read`, `listIssues`, `getIssue`, `startMissionFromIssue`, and `startMissionFromBrief`; unknown entity/method failures; invalid payload/result failures; protocol version update.

Failure signals: registry dispatch, prototype probing, unparsed results, fallback normalization, missing instance accepted, or broad compatibility path.

Ignore: unrelated web checks.

Evidence: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
