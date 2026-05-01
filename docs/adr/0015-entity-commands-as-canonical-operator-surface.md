# Entity Commands As Canonical Operator Surface

Entity commands are the canonical operator surface for Mission, Stage, Task, Artifact, AgentSession, and future command-capable Entities. A command is identified by `commandId` and may carry typed `input`.

Airport is a control surface and proxy. It renders `EntityCommandDescriptor` values, gathers any command input or confirmation, and forwards the descriptor `commandId` through the SvelteKit gateway to daemon `entity.command`. Airport may keep helper methods for documents, worktrees, terminals, prompt delivery, and event streams where those helpers represent distinct transport behavior, but it must not invent Mission behavior or a second command vocabulary.

The daemon request surface is intentionally small: `ping`, `event.subscribe`, `system.status`, `entity.query`, and `entity.command`. Entity behavior belongs behind Entity contracts.

Entity contracts own remote method metadata: payload schema, result schema, execution mode, and event payload schema. Entity classes own behavior. For Mission-tree commands, the ownership model is that each child Entity contract owns its command ids and input schemas, while the Running Mission aggregate remains the delegate for behavior that changes aggregate workflow state.

Command acknowledgements mean the command was accepted and attempted at the authoritative Entity boundary. Resulting state is carried by schema-validated snapshots, runtime events, or follow-up reads. Acknowledgements must not be treated as a replacement for emitted state.

Consequences:

- Command payloads use `{ missionId, commandId, input? }` plus the target id needed by the addressed Entity.
- Airport command UI uses Commandbar naming.
- Entity snapshots advertise commands; callers send back the advertised `commandId`.
- Child Entity command ids and input schemas should move into the owning child Entity schema/contract files.
- Artifact should not expose `executeCommand` unless it has real Artifact-owned commands.
- Runtime inputs such as AgentSession prompt delivery, Agent runtime messages, and raw terminal input must be documented either as typed Entity commands or as explicit non-command input channels.
