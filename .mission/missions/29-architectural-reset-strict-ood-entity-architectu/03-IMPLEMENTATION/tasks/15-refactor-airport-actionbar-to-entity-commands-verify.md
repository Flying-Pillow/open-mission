---
taskKind: "verification"
pairedTaskId: "implementation/15-refactor-airport-actionbar-to-entity-commands"
dependsOn: ["implementation/15-refactor-airport-actionbar-to-entity-commands"]
agent: "copilot-cli"
---

# Verify Entity Command Actionbar

Paired task: `implementation/15-refactor-airport-actionbar-to-entity-commands`.

Focused checks: Actionbar accepts commandable entities only, renders entity-returned commands without local domain filtering, and no active Airport component passes `scope`, `taskId`, `artifactPath`, or `sessionId` for action discovery. Confirm Task, Artifact, AgentSession, Stage, and Mission mirrors own their command access methods.

Failure signals: `ScopedActionbar` or equivalent still composes action contexts, UI filters commands by target ids, or command discovery bypasses entity mirrors.

Evidence: append web test output, browser Mission-panel check, and static scan results to `03-IMPLEMENTATION/VERIFY.md`.
