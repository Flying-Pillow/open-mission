---
taskKind: "implementation"
pairedTaskId: "implementation/11-clean-airport-mission-mirror-verify"
dependsOn: ["implementation/10-route-mission-through-explicit-dispatch-verify"]
agent: "copilot-cli"
---

# Clean Airport Mission Mirror

Objective: make the Airport Mission mirror the component-facing owner of Mission request-response behavior through generic entity remotes.

Context: read `02-SPEC/SPEC.md`, `apps/airport/web/src/lib/components/entities/Mission/Mission.svelte.ts`, `MissionCommandTransport.ts`, `MissionRuntimeTransport.ts`, Task/Artifact/AgentSession mirrors, generic remote wrappers, and Mission route fetch callers.

Allowed files: Airport Mission mirror, Mission transports, Task/Artifact/AgentSession mirror command delegation, application container wiring, focused web tests, and minimal route call-site updates.

Forbidden files: daemon behavior changes beyond import/schema alignment, terminal socket implementation changes, broad visual redesign, and unrelated component refactors.

Expected change: Mission read/control/action/document/worktree behavior goes through Mission entity methods and generic query/command remotes. Mission, Task, Artifact, and AgentSession mirrors expose domain-shaped methods while components stop composing backend payloads or calling route-local Mission APIs directly.

Compatibility policy: command methods may keep local pending/error state, but they must not require command-returned `MissionRuntimeSnapshot` values for reconciliation. Broader state updates come from query refreshes or SSE projection events.

Validation gate: focused Airport web tests for Mission read and commands through generic remotes, static browser-boundary scans, and component call-site scans for route-local Mission API bypasses.
