---
taskKind: "implementation"
pairedTaskId: "implementation/05-align-ui-components-with-entity-and-app-context-apis-verify"
dependsOn: ["implementation/04-move-transport-behavior-behind-frontend-entities-verify"]
agent: "copilot-cli"
---

# Align UI Components With Entity And App Context APIs

Align mission-control, artifact, actionbar, terminal, and route components so they consume entity methods and `appContext` only. This slice should cover the repository and mission route pages, `BriefForm.svelte`, `IssueList.svelte`, `ScopedActionbar.svelte`, `MissionTerminal.svelte`, `AgentSession.svelte`, `ArtifactViewer.svelte`, `ArtifactEditor.svelte`, and any remaining runtime endpoints that must stay transport-only behind entity-owned observation APIs.

Use the product artifacts in this mission folder as the canonical context boundary.
