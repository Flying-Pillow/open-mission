---
layout: default
title: Entity Commands As Canonical Operator Surface
parent: Architecture Decisions
nav_order: 15
status: accepted
date: 2026-05-04
decision_area: entity-command-surface
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Entity commands are the canonical operator surface for Repository, Mission, Stage, Task, Artifact, AgentSession, and future command-capable Entities. A command is identified by `commandId` and may carry typed `input`.

Airport is a control surface and proxy. It renders `EntityCommandDescriptor` values from Entity command views, gathers any command input or confirmation, and forwards the descriptor `commandId` through the SvelteKit gateway to daemon `entity.command`. Airport may keep helper methods for artifacts, worktrees, terminals, prompt delivery, and event streams where those helpers represent distinct transport behavior, but it must not invent Mission behavior or a second command vocabulary.

Entity command views are split by execution target. `commands` advertises instance-level commands for one target Entity id. `classCommands` advertises class-level commands for an Entity class when the operator action is not tied to an existing Entity instance, such as Repository clone or registration. Both views are derived from Entity contract metadata and Entity availability methods; neither view is Entity data.

The daemon request surface is intentionally small: `ping`, `event.subscribe`, `system.status`, `entity.query`, and `entity.command`. Entity behavior belongs behind Entity contracts.

Entity contracts own remote method metadata: payload schema, result schema, execution mode, and event payload schema. Entity classes own behavior. For Mission-tree commands, the ownership model is that each child Entity contract owns its command ids and input schemas, while the Running Mission aggregate remains the delegate for behavior that changes aggregate workflow state.

Artifact body reads are Entity queries because they retrieve Artifact body payload through the Artifact Entity contract. Artifact body edits are Artifact-owned commands, not a separate `writeBody` method vocabulary. A surface updates an Artifact body by calling `entity.command` for `Artifact.command` with the Artifact target id, an Artifact command id, and typed body input. The body shape remains `ArtifactBodySchema`; there must not be a parallel write-body schema when the payload is the Artifact body itself. Artifact body transport must not persist or require MIME metadata; presentation surfaces derive preview and editor behavior from Artifact metadata such as file name and path.

Command acknowledgements mean the command was accepted and attempted at the authoritative Entity boundary. Resulting state is carried by schema-validated Entity data, true snapshots, runtime events, or follow-up reads. Acknowledgements must not be treated as a replacement for emitted state.

Consequences:

- Command payloads use the target Entity locator, the advertised `commandId`, and optional typed `input` needed by the owning Entity contract; callers do not supply extra transport ids or `eventId` fields.
- Airport command UI uses Commandbar naming.
- Entity command views advertise available commands; Entity data schemas must not contain command descriptors.
- Class-level commands are advertised through `classCommands`, not through ambiguous source, collection, or global command vocabulary.
- Callers send back the advertised `commandId` with the target Entity locator and typed input required by the owning Entity contract.
- Child Entity command ids and input schemas should move into the owning child Entity schema/contract files.
- Artifact exposes `command` only for real Artifact-owned commands such as body update; it must not expose ad hoc mutation method names like `writeBody`.
- Runtime inputs such as AgentSession prompt delivery, Agent runtime messages, and raw terminal input must be documented either as typed Entity commands or as explicit non-command input channels.
