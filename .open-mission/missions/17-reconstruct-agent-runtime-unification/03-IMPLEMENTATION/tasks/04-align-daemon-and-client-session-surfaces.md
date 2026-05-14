---
dependsOn: ["implementation/02-align-orchestrator-and-persisted-session-coordination","implementation/03-align-workflow-request-execution-with-unified-runtime"]
agent: "copilot-cli"
---

# Align Daemon And Client Session Surfaces

Align daemon and client session surfaces with one runtime registry and one session-control path. This slice should keep configured runner loading, daemon protocol naming, mission-facing session operations, and client launch or prompt or command surfaces coherent across `packages/core/src/daemon/runDaemonMain.ts`, `defaultRuntimeFactory.ts`, `Workspace.ts`, `protocol.ts`, `packages/core/src/client/*`, and related daemon mission session helpers.

Use the product artifacts in this mission folder as the canonical context boundary.