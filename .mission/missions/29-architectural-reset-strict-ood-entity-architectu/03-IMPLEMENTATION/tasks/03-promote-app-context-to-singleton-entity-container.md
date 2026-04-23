---
taskKind: "implementation"
pairedTaskId: "implementation/03-promote-app-context-to-singleton-entity-container-verify"
dependsOn: ["implementation/02-introduce-generic-entity-remote-boundary-verify"]
agent: "copilot-cli"
---

# Promote App Context To Singleton Entity Container

Convert Airport's application wiring so `Application.svelte.ts`, `app-context.svelte.ts`, and adjacent client runtime surfaces become one long-lived singleton application and session-wide container that own active `Repository`, `Mission`, `Stage`, `Task`, `Artifact`, and `AgentSession` instances. This slice should replace selection-bag behavior with explicit entity lifecycle, synchronization, and reuse across route transitions while keeping shell-only daemon and GitHub session state at the container boundary.

Use the product artifacts in this mission folder as the canonical context boundary.
