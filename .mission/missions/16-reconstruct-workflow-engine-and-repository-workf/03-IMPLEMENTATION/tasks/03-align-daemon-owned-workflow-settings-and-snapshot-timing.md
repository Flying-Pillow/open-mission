---
dependsOn: ["implementation/01-establish-workflow-runtime-document-and-reducer-boundary","implementation/02-align-deterministic-task-generation-and-scheduling"]
agent: "copilot-cli"
---

# Align Daemon-Owned Workflow Settings And Snapshot Timing

Align repository workflow policy with the preserved daemon-owned settings contract without collapsing repository policy into workflow surfaces. This slice should keep workflow settings initialization, RFC 6902 patching, revision conflict checks, atomic persistence, daemon API routing, and `draft` to `ready` workflow snapshot timing coherent across `packages/core/src/settings/*`, `packages/core/src/lib/daemonConfig.ts`, `packages/core/src/daemon/Workspace.ts`, `packages/core/src/daemon/mission/Factory.ts`, and the client control surfaces that consume those daemon methods.

Use the product artifacts in this mission folder as the canonical context boundary.
