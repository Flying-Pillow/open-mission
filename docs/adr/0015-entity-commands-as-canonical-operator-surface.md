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

Entity commands are the canonical operator surface for Repository, Mission, Stage, Task, Artifact, AgentExecution, and future command-capable Entities. An Entity command is a surface-facing invocation descriptor for a mutation method declared by an Entity contract and implemented by the owning Entity class. A command descriptor carries the derived `commandId`, `entity`, `method`, optional `targetId`, UI metadata, and advisory availability.

Open Mission is a control surface and proxy. It renders `EntityCommandDescriptor` values from hydrated Entity `commands` fields or Entity command views, gathers any command input or confirmation, and forwards the descriptor method with the target Entity locator through the SvelteKit gateway to daemon `entity.command`. Open Mission may keep helper methods for artifacts, worktrees, terminals, prompt delivery, and event streams where those helpers represent distinct transport behavior, but it must not invent Mission behavior or a second command vocabulary.

Entity command descriptors are generated generically by iterating `<Entity>Contract.ts` methods. A method becomes a command when it is a mutation with `ui` metadata. `commandId` is derived from the Entity name and method name, such as `task.start`; it is not a behavior switch. Availability is derived from the owning Entity method named `can<MethodName>` when present, such as `canStart`, and defaults to available when absent. The daemon rechecks `can<MethodName>` before invoking the mutation, so descriptor availability is advisory surface material rather than authority.

Entity command views are split by execution target. `commands` advertises instance-level commands for one target Entity id. `classCommands` advertises class-level commands for an Entity class when the operator action is not tied to an existing Entity instance, such as Repository clone or registration. Both views are derived from Entity contract metadata and Entity availability methods. Command views are not persisted Entity storage data; they may also be embedded as `commands` in a hydrated `<Entity>Schema` when the Entity boundary returns a complete operator-facing Entity instance.

The daemon request surface is intentionally small: `ping`, `event.subscribe`, `system.status`, `entity.query`, and `entity.command`. Entity behavior belongs behind Entity contracts.

Entity contracts own remote method metadata: payload schema, result schema selection, execution mode, event payload schema, and UI metadata. Entity classes own behavior and availability. Contracts point at canonical schemas owned by the Entity schema module; they do not define a parallel method-response model when the method returns an existing Entity shape. For Mission-tree commands, each child Entity contract owns its methods and input schemas, while the Running Mission aggregate may remain the delegate for behavior that changes aggregate workflow state.

Artifact body reads are Entity queries because they retrieve Artifact body payload through the Artifact Entity contract. Artifact body edits are Artifact-owned commands, not a separate `writeBody` method vocabulary. A surface updates an Artifact body by calling `entity.command` for `Artifact.command` with the Artifact target id, an Artifact command id, and typed body input. The body shape remains `ArtifactBodySchema`; there must not be a parallel write-body schema when the payload is the Artifact body itself. Artifact body transport must not persist or require MIME metadata; presentation surfaces derive preview and editor behavior from Artifact metadata such as file name and path.

Command acknowledgements mean the command was accepted and attempted at the authoritative Entity boundary. Resulting state is carried by schema-validated Entity data, true snapshots, runtime events, or follow-up reads. Acknowledgements must not be treated as a replacement for emitted state.

Consequences:

- Command payloads use the target Entity locator and the typed input needed by the owning Entity contract; callers do not supply extra transport ids or `eventId` fields.
- Open Mission command UI uses Commandbar naming.
- Entity command views advertise Entity method descriptors. `<Entity>StorageSchema` must not contain command descriptors. Hydrated `<Entity>Schema` may contain `commands` because command availability is derived Entity boundary read material, not persisted truth.
- Class-level commands are advertised through `classCommands`, not through ambiguous source, collection, or global command vocabulary.
- Callers invoke the advertised descriptor method with the target Entity locator and typed input required by the owning Entity contract.
- Child Entity methods and input schemas belong in the owning child Entity schema/contract files; Mission must not carry a Mission-specific child command list.
- Artifact exposes `command` only for real Artifact-owned commands such as body update; it must not expose ad hoc mutation method names like `writeBody`.
- Runtime inputs such as AgentExecution prompt delivery, Agent execution messages, and raw terminal input must be documented either as typed Entity commands or as explicit non-command input channels.
