---
taskKind: "implementation"
pairedTaskId: "implementation/04-move-transport-behavior-behind-frontend-entities-verify"
dependsOn: ["implementation/03-promote-app-context-to-singleton-entity-container-verify"]
agent: "copilot-cli"
---

# Move Transport Behavior Behind Frontend Entities

Move repository, mission, stage, task, artifact, and agent-session transport behavior behind shared frontend entity base behavior and concrete entity methods. This slice should establish `apps/airport/web/src/lib/client/entities/Entity.svelte.ts`, align `Repository.ts`, `Mission.ts`, `Stage.ts`, `Task.ts`, `AgentSession.ts`, and new `Artifact.ts`, and reduce `AirportClientRuntime.ts` plus the current transport helpers to implementation details hidden behind entity-owned query or command or form or streaming APIs.

Use the product artifacts in this mission folder as the canonical context boundary.
