---
taskKind: "implementation"
pairedTaskId: "implementation/14-route-child-entity-commands-through-dispatch-verify"
dependsOn: ["implementation/13-create-child-entity-command-contracts-verify"]
agent: "copilot-cli"
---

# Route Child Entity Commands Through Dispatch

Objective: add explicit daemon handlers for Stage, Task, Artifact, and AgentSession command discovery and execution, with command ownership on the child entities themselves.

Context: read `02-SPEC/SPEC.md`, `packages/core/src/daemon/entityRemote.ts`, `packages/core/src/entities/Mission/MissionCommands.ts`, `packages/core/src/mission/Mission.ts`, and `packages/core/src/lib/operatorActionTargeting.ts`.

Allowed files: daemon dispatch, focused child entity command collaborators, Mission aggregate/runtime access helpers, shared tests, and protocol versioning when daemon RPC behavior changes.

Forbidden files: dynamic dispatch registries, UI actionbar rewrites, broad workflow reducer rewrites, terminal socket/PTY transport changes, new child public methods on `MissionCommands`, and generic command dumping buckets such as `MissionCommandsSupport`.

Expected change: create or update `StageCommands`, `TaskCommands`, `ArtifactCommands`, and `AgentSessionCommands` as the public command collaborators for their entities. `Stage.read/listCommands/executeCommand`, `Task.read/listCommands/executeCommand`, `Artifact.read/readDocument/writeDocument/listCommands/executeCommand`, and `AgentSession.read/listCommands/executeCommand/sendPrompt/sendCommand` route through explicit daemon handlers to those entity-owned command collaborators. The collaborators may resolve the owning Mission aggregate internally, but `MissionCommands` remains Mission-only. Handlers parse payloads before execution, parse results after execution, and return entity command acknowledgements or direct source-local results.

Compatibility policy: no arbitrary method lookup, no Mission-wide action filtering as a public target contract, no command response projection shortcuts, and no duplicate workflow policy logic outside Mission/policy collaborators.

Validation gate: focused daemon dispatch tests for each child entity, invalid payload/result failures, missing mission/child failures, command descriptor scoping, protocol version evidence, and a structure check showing child entity commands no longer live on `MissionCommands`. Check whether `Repository`/`GitHubRepository` should follow the same command-collaborator structure and record the result before completing the task.
