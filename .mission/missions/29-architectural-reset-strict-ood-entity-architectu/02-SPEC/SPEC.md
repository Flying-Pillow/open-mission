---
title: "SPEC: #29 - Architectural Reset: Strict OOD Entity Architecture For Airport And Daemon"
artifact: "spec"
createdAt: "2026-04-22T14:54:07.971Z"
updatedAt: "2026-04-26T16:25:00.000+00:00"
stage: "spec"
---

Branch: mission/29-architectural-reset-strict-ood-entity-architectu

## Mission Intent

Mission `29` resets Airport and daemon communication around strict object-oriented mirrored entities.

The daemon is the authority. It owns entity identity, entity state, entity behavior, validation, persistence, side effects, and event publication. Airport web owns client-side mirrored entity instances, UI lifecycle, local pending/error state, and reconciliation of daemon projections.

The target architecture keeps the useful part of the reference application in `/repositories/Flying-Pillow/flying-pillow/apps/app`: client entities call a small generic remote boundary, and backend entities execute the real behavior. It deliberately does not copy the reference application's dynamic entity registry, metadata model system, generic UI/action metadata, autosave/history stack, or broad result-envelope machinery.

The first implementation target is `Repository`. Repository has now proven the architecture: canonical schemas own payload and result contracts, daemon dispatch is explicit, source commands can return acknowledgements, and Airport web can call generic entity remotes through a client mirror.

The next implementation target is `Mission`. Mission is the most important entity in the system because it is the runtime workflow aggregate. It owns mission lifecycle, workflow coordination, stage/task/artifact/session membership, and operator control over mission execution. Migrating Mission must not copy the older route-local runtime API into a new file name; it must complete the strict entity architecture for the workflow engine boundary.

## Architectural Decisions

- The daemon is the single source of truth.
- Backend/domain entities live in `packages/core/src/entities`.
- Shared schemas live in `packages/core/src/schemas`.
- `packages/core/src/schemas/index.ts` is the canonical public schema barrel.
- `packages/core/src/airport/runtime.ts` is not a canonical schema surface and must be decomposed.
- Airport web never defines alternate domain truth.
- SvelteKit server code never executes entity business behavior; it forwards entity invocations to the daemon.
- Browser code never imports daemon-only or Node-only modules.
- Entity remote calls use the triplet `{ entity, method, payload }`.
- Queries return raw schema-validated data.
- Commands return source-operation acknowledgement or a direct source-local result.
- Commands do not return broad projection snapshots for unrelated entity side effects.
- Entity state changes caused outside the direct source result are delivered by daemon SSE projection events.
- Unknown entities, unknown methods, invalid payloads, invalid results, and missing daemon context fail loudly.
- The target design contains no fallbacks, no backward compatibility paths, no compatibility aliases, no route-specific duplicate remotes, and no normalization layers.
- `packages/core/package.json` exposes only minimal stable package entrypoints.

## Vocabulary

### Entity

An entity is a domain object with identity, state, behavior, and a shared schema contract. Target entities are:

- `Repository`
- `Mission`
- `Stage`
- `Task`
- `Artifact`
- `AgentSession`

### Client Mirror

A client mirror is a browser-side object representing a daemon-owned entity. It may keep reactive UI state and expose methods to components. It is not authoritative.

### Source Operation

A source operation is the direct query or command invoked by a client mirror, such as `Repository.find` or `Repository.startMissionFromIssue`.

### Projection Event

A projection event is an SSE event published by the daemon to describe authoritative state changes. Projection events update mirrored entities after workflow, mission, task, artifact, session, or repository side effects occur.

### Runtime

`runtime` is reserved for active execution boundaries such as workflow execution, agent session execution, terminal streams, and SSE streams. Entity wrappers must not be named `RepositoryRuntime`, `MissionRuntime`, or similar unless they truly represent active execution infrastructure.

## Non-Goals

- No generic entity registry.
- No class/prototype method probing in the daemon.
- No schema strings resolved through a client-side model registry.
- No public wildcard package exports.
- No route-specific remote APIs for each component or route.
- No command response that doubles as a global projection payload.
- No partial parser fallback when a shared Zod schema exists.
- No temporary compatibility design in the target specification.
- No preservation of `airport/runtime.ts` as a schema dumping ground.

## GitHub Repositories Assessment

The GitHub repositories browser should continue through a first-class `GitHubRepository` source entity, but only as a provider-backed remote-repository source, not as a second local `Repository` aggregate.

`Repository` remains the local registered checkout aggregate. It owns local repository identity, mission control initialization, mission discovery, issue-backed mission creation for a registered checkout, and brief-backed mission creation.

`GitHubRepository` owns source-provider repository discovery and clone/import behavior before a local checkout exists. It is the correct boundary for Airport's GitHub repositories panel because those records are remote provider resources rather than registered Mission repositories.

The `GitHubRepository` entity must delegate provider behavior through the repository platform adapter boundary. It must not call `GitHubPlatformAdapter` directly in target code. Direct GitHub CLI details belong behind `RepositoryPlatformAdapter` and a provider factory, so the same source-entity shape can later support GitLab, Jira issue sources, or other repository and issue tracker providers.

The target shape is:

- `GitHubRepository.find` lists remote repositories through `createRepositoryPlatformAdapter({ platform: "github", ... })`.
- `GitHubRepository.clone` clones through the same platform adapter and then registers/hydrates a local `Repository` snapshot.
- Shared schemas for visible remote repositories and clone payloads live under `packages/core/src/schemas`, not under deep entity remote files or `airport/runtime.ts`.
- Daemon dispatch explicitly routes `GitHubRepository.find` and `GitHubRepository.clone` alongside `Repository` handlers.
- Airport's `GithubRepository` client mirror calls the generic entity remotes only.
- The minimal daemon must implement the source entity methods instead of leaving Airport to call `control.github.repositories.list` directly.

This keeps platform discovery separate from local repository control while opening the later path to provider-neutral source repositories and issue trackers.

## Target Layering

### Core Domain Layer

Location: `packages/core/src/entities`

Responsibilities:

- Implement daemon-authoritative entity classes.
- Own entity behavior and business rules.
- Use shared schemas for input, output, and snapshots.
- Return explicit JSON-safe values from daemon-callable methods.
- Delegate infrastructure to focused collaborators without creating parallel entity wrappers.

### Shared Schema Layer

Location: `packages/core/src/schemas`

Responsibilities:

- Define entity data schemas.
- Define entity snapshot schemas.
- Define entity method payload schemas.
- Define entity method result schemas.
- Define generic entity remote invocation schemas.
- Define command acknowledgement schemas.
- Define SSE event envelope and payload schemas.
- Export all public schemas through `packages/core/src/schemas/index.ts`.

### Daemon Dispatch Layer

Location: `packages/core/src/daemon`

Responsibilities:

- Receive daemon RPC requests.
- Validate generic entity invocations.
- Dispatch explicitly to known entity methods.
- Resolve instances explicitly for instance methods.
- Parse method payloads and results with shared schemas.
- Publish projection events after authoritative state changes.

### SvelteKit Remote Gateway Layer

Location: `apps/airport/web/src/routes/api/entities/remote`

Responsibilities:

- Expose one generic query remote.
- Expose one generic command remote.
- Validate generic invocation shape.
- Forward invocations to the daemon through `EntityProxy`.
- Return daemon results unchanged except for transport-level serialization.

This layer must not contain entity business rules.

### Airport Client Entity Layer

Location: `apps/airport/web/src/lib/components/entities` or a future dedicated client entity directory

Responsibilities:

- Hold mirrored entity instances.
- Expose entity methods to route and component code.
- Call generic query and command remotes.
- Parse remote results with shared schemas.
- Reconcile snapshots from queries and SSE events.
- Maintain local pending/error/success UI state.

### Projection Transport Layer

Location: `apps/airport/web/src/routes/api/runtime/events/+server.ts` and client event subscribers

Responsibilities:

- Forward daemon notifications to the browser as SSE.
- Validate event envelopes with shared schemas.
- Reconcile entity mirrors from projection events.
- Keep streaming transport separate from source command responses.

## Shared Schemas

All schemas required by both daemon and browser move under `packages/core/src/schemas`.

### Required Schema Modules

| Module | Owns |
| --- | --- |
| `Repository.ts` | Repository data, input, identity payloads, mission references, repository snapshots, Repository method payloads, Repository method results |
| `EntityRemote.ts` | Generic entity invocation schemas, query invocation schema, command invocation schema, form invocation schema if required, command acknowledgement schema |
| `RuntimeEvents.ts` | SSE event type schema, event envelope schema, projection payload schemas |
| `Mission.ts` | Mission data, snapshot, method payload, method result, action, document, worktree, and acknowledgement schemas |
| `MissionRuntime.ts` | Temporary source for existing runtime shapes during migration only; must be folded into `Mission.ts` or reduced to execution-internal schemas |
| `SystemState.ts` | System state schemas |
| `AirportClient.ts` | Airport-client-only public types that are genuinely schema-facing |

### Schema Rules

- Schemas are strict unless a specific open record is part of the domain contract.
- Empty payloads are represented by strict empty objects.
- No `.passthrough()` on entity method payloads.
- Method payload schemas live with the entity schema module, not beside daemon dispatch code.
- Method result schemas live with the entity schema module, not in client code.
- Browser code imports schemas from `@flying-pillow/mission-core/schemas`.
- Deep imports from `@flying-pillow/mission-core/entities/*Remote*` are forbidden.
- `airport/runtime.ts` must not own entity data schemas, method schemas, or event schemas.

## Generic Entity Remote Contract

The generic remote invocation shape is intentionally small.

### Query Invocation

```ts
type EntityQueryInvocation = {
  entity: string;
  method: string;
  payload?: unknown;
};
```

### Command Invocation

```ts
type EntityCommandInvocation = {
  entity: string;
  method: string;
  payload?: unknown;
};
```

### Command Acknowledgement

```ts
type EntityCommandAcknowledgement = {
  ok: true;
  entity: string;
  method: string;
  id?: string;
};
```

The exact acknowledgement schema may include entity-specific fields when the source entity needs them, but it must not become a projection snapshot for unrelated entities.

### Query Semantics

- Queries return raw typed data.
- Query results are parsed by the daemon before returning.
- Client mirrors parse query results again at the trust boundary.
- Query methods must not mutate authoritative state.

### Command Semantics

- Commands mutate authoritative daemon-owned state.
- Commands return source-operation acknowledgement or direct source-local result.
- Commands may cause workflow, mission, task, artifact, session, or repository side effects.
- Side effects are observed through SSE projection events.
- Command responses are not the mechanism for global client state reconciliation.

## Daemon Dispatch Contract

The daemon dispatch implementation must be explicit.

### Required Properties

- One explicit dispatcher per entity.
- One explicit handler per callable method.
- Each handler declares whether it is a query or command.
- Each handler owns the mapping from method name to payload schema and result schema.
- Static methods are called explicitly.
- Instance methods resolve the instance explicitly before invocation.
- Missing instances fail loudly.
- Method results are parsed before returning.

### Forbidden Properties

- No dynamic registry metadata system.
- No generic class/prototype probing.
- No method execution by arbitrary string lookup without an explicit handler.
- No generic `normalizeEntityRemoteResult`.
- No automatic `toJSON` conversion.
- No silent null result conversion.
- No fallback surface path resolution inside entity logic.

## Repository Entity Contract

Repository is the first entity used to prove the architecture.

### Repository Responsibilities

- Repository identity.
- Canonical local repository root path.
- Display label and description.
- GitHub repository association when known.
- Repository settings.
- Repository workflow configuration.
- Initialization state.
- Mission discovery.
- Issue lookup for issue-backed mission creation.
- Mission creation from issue.
- Mission creation from brief.

### Repository Must Not Own

- Daemon request routing.
- SSE transport.
- Terminal/session transport.
- Process-wide runtime registries.
- Workflow-engine execution state.
- Client route orchestration.
- Repository collection duties.
- Parallel wrappers such as `RepositoryController`, `RepositoryDaemonController`, or `RepositoryRuntime`.

### Repository Data Properties

| Property | Description |
| --- | --- |
| `repositoryId` | Stable repository identity |
| `repositoryRootPath` | Canonical local checkout root |
| `ownerId` | Repository owner identity |
| `repoName` | Repository name |
| `label` | Display label |
| `description` | Display description |
| `githubRepository` | Optional GitHub `owner/name` reference |
| `settings` | Repository settings document |
| `workflowConfiguration` | Prepared workflow configuration |
| `isInitialized` | Whether Mission control is initialized for this repository |

### Repository Snapshot

`RepositorySnapshot` is the entity-shaped projection returned by Repository queries and SSE events.

It contains:

- `repository`
- `operationalMode`
- `controlRoot`
- `currentBranch`
- `settingsComplete`
- `githubRepository`
- `missions`
- `selectedMissionId`
- `selectedMission`
- `selectedIssue`

Only fields that belong to the Repository projection belong here. Workflow execution details belong to Mission, Stage, Task, Artifact, or AgentSession projections.

### Repository Query Methods

| Method | Kind | Payload | Result |
| --- | --- | --- | --- |
| `find` | static query | strict empty object | `RepositorySnapshot[]` |
| `read` | instance query | `RepositoryIdentityPayload` | `RepositorySnapshot` |
| `listIssues` | instance query | `RepositoryIdentityPayload` | `TrackedIssueSummary[]` |
| `getIssue` | instance query | `RepositoryIdentityPayload & { issueNumber }` | `GitHubIssueDetail` |

### Repository Command Methods

| Method | Kind | Payload | Result |
| --- | --- | --- | --- |
| `add` | static command | `{ repositoryPath }` | `RepositorySnapshot` |
| `startMissionFromIssue` | instance command | `RepositoryIdentityPayload & { issueNumber }` | `EntityCommandAcknowledgement` with mission id if needed |
| `startMissionFromBrief` | instance command | `RepositoryIdentityPayload & { title, body, type }` | `EntityCommandAcknowledgement` with mission id if needed |

`add` may return `RepositorySnapshot` because the source entity is Repository and the UI needs the newly registered repository immediately. Mission-start commands must not return full Mission or workflow projections. Those changes are projected through SSE.

## Repositories Collection Contract

`Repositories` owns collection-level Repository concerns.

Responsibilities:

- Register repositories.
- List registered repositories.
- Resolve repositories by id.
- Resolve repositories by path.
- Open Repository instances from registration records.

It must not own:

- Per-repository business behavior.
- Daemon dispatch.
- Runtime execution.
- SSE publication.
- Terminal/session behavior.

## Mission, Stage, Task, Artifact, And AgentSession Direction

Repository has proven the strict foundation. Mission is now the next required migration target. Stage, Task, Artifact, and AgentSession must be projected from Mission first, then promoted into their own daemon-callable entity contracts only where they own direct behavior.

### Mission

`Mission` owns mission identity, lifecycle, status projection, workflow coordination, stage membership, task membership, artifact membership, agent-session membership, mission-level operator actions, task launch/completion/reopen intent, agent-session control intent, mission document access, mission worktree inspection, and workflow action execution.

The historical code showed a transitional split:

- `packages/core/src/entities/Mission/Mission.ts` is a first-class entity projection built from `OperatorStatus`, but it does not yet own daemon-callable behavior.
- `packages/core/src/entities/Mission/MissionRemote.ts` owns daemon-callable behavior, runtime loading, runtime snapshot construction, and command result shaping.
- `packages/core/src/entities/Mission/MissionRemoteContract.ts` owned Mission remote payload schemas from a deep entity path and must not be retained as a wrapper.
- `packages/core/src/schemas/MissionRuntime.ts` owns Mission runtime snapshot, command, stage, task, artifact, and agent-session schemas.
- `apps/airport/web/src/lib/components/entities/Mission/Mission.svelte.ts` is the browser Mission mirror, but it still expects command methods to return broad `MissionRuntimeSnapshot` values and still reaches route-local runtime APIs through its command gateway.

The target migration collapses that split into a canonical entity contract without making the SvelteKit server or Airport components authoritative.

### Mission Must Own

- Mission identity and repository-scoped mission resolution.
- Mission descriptor projection: title, issue, type, branch, directories, operational mode, and recommended action.
- Mission workflow projection: lifecycle, active/current stage, stages, tasks, gates when exposed, and updated timestamp.
- Mission artifact membership and mission document read/write behavior.
- Mission agent-session membership and session control intent.
- Mission action discovery and action execution as workflow-control behavior.
- Mission worktree inspection when it is scoped to the mission dossier or mission worktree.
- Conversion from workflow/runtime state into entity-shaped snapshots.
- Source acknowledgements for mission, task, session, action, document-write, and worktree-affecting commands.

### Mission Must Not Own

- Repository registration, settings ownership, workflow preset ownership, issue discovery, or mission creation from issue/brief. Those remain Repository responsibilities.
- Daemon request routing or protocol version policy.
- SvelteKit request handling, cookie/session auth, or route composition.
- Terminal socket transport, raw PTY streaming, EventSource plumbing, or browser subscription mechanics.
- Provider-specific agent adapter behavior.
- Workflow reducer rules as UI logic. Reducer/policy rules remain workflow-engine internals consumed by Mission.
- Stage, Task, Artifact, or AgentSession direct behavior once those entities are promoted to first-class source entities.
- `MissionRuntimeSnapshot` as a command response for unrelated global reconciliation.

### Mission Data Properties

| Property | Description |
| --- | --- |
| `missionId` | Stable mission identity |
| `repositoryId` | Stable Repository identity when known |
| `repositoryRootPath` | Canonical local checkout root used to resolve the mission |
| `title` | Display title |
| `issueId` | Optional source issue number |
| `type` | Mission type such as feature, fix, docs, refactor, or task |
| `operationalMode` | Active operation mode when projected |
| `branchRef` | Mission branch reference |
| `missionDir` | Dossier directory for mission artifacts |
| `missionRootDir` | Canonical mission root directory |
| `lifecycle` | Workflow lifecycle state |
| `updatedAt` | Last authoritative workflow update timestamp |
| `currentStageId` | Current or active stage id when known |
| `recommendedAction` | Operator-facing recommended next action |

### Mission Snapshot

`MissionSnapshot` is the entity-shaped projection returned by Mission queries and SSE events.

It contains:

- `mission`
- `workflow`
- `stages`
- `tasks`
- `artifacts`
- `agentSessions`
- `actions` when explicitly queried or projected as a Mission action projection
- `control` only when it is normalized as Mission-owned control data, not as a route bundle
- `worktree` only when queried from Mission and validated by shared schemas

The snapshot must not be a storage mirror of `.mission/missions/<mission-id>/mission.json`. `mission.json` remains the persisted workflow runtime document. `MissionSnapshot` is an entity projection for client mirrors and daemon callers.

### Mission Query Methods

| Method | Kind | Payload | Result |
| --- | --- | --- | --- |
| `read` | instance query | `MissionIdentityPayload` | `MissionSnapshot` |
| `readControl` | instance query | `MissionIdentityPayload` | `MissionControlSnapshot` or normalized Mission control schema |
| `listActions` | instance query | `MissionIdentityPayload & { context? }` | `MissionActionListSnapshot` |
| `readDocument` | instance query | `MissionIdentityPayload & { path }` | `MissionDocumentSnapshot` |
| `readWorktree` | instance query | `MissionIdentityPayload` | `MissionWorktreeSnapshot` |

`read` is the canonical Mission entity read. `readControl`, `listActions`, `readDocument`, and `readWorktree` are allowed only because they are Mission-scoped source queries. They must move off route-local runtime fetches and into generic entity query remotes.

### Mission Command Methods

| Method | Kind | Payload | Result |
| --- | --- | --- | --- |
| `command` | instance command | `MissionIdentityPayload & { command }` | `MissionCommandAcknowledgement` |
| `taskCommand` | instance command | `MissionIdentityPayload & { taskId, command }` | `MissionCommandAcknowledgement` |
| `sessionCommand` | instance command | `MissionIdentityPayload & { sessionId, command }` | `MissionCommandAcknowledgement` |
| `executeAction` | instance command | `MissionIdentityPayload & { actionId, steps?, terminalSessionName? }` | `MissionCommandAcknowledgement` with action id if needed |
| `writeDocument` | instance command | `MissionIdentityPayload & { path, content }` | `MissionDocumentWriteAcknowledgement` or direct `MissionDocumentSnapshot` only when the edited document is the source result |

Mission commands must migrate to source acknowledgement plus SSE projection. Broad `MissionRuntimeSnapshot` command responses are forbidden in the target architecture. A command may return direct source-local data only when that data is the source result of the command itself, such as a document write returning the saved document payload. It must not return the global Mission/workflow/task/session projection as a reconciliation shortcut.

### Mission Command Acknowledgement

```ts
type MissionCommandAcknowledgement = {
  ok: true;
  entity: "Mission";
  method: string;
  id: string;
  missionId: string;
  taskId?: string;
  sessionId?: string;
  actionId?: string;
};
```

The exact schema must be strict and method-aware. It may include source identifiers needed for optimistic UI state or route derivation. It must not include `status`, `sessions`, `workflow`, or other broad projection fields.

### Mission Runtime Loading

Mission instance resolution must be explicit, mirroring Repository instance resolution.

Required behavior:

- Parse `MissionIdentityPayload` before resolving the instance.
- Resolve `repositoryRootPath` from payload or daemon surface context only at the daemon boundary.
- Resolve the Mission runtime through a focused Mission factory/load collaborator.
- Fail loudly when the mission cannot be resolved.
- Dispose runtime resources after source method execution.
- Parse method results before returning them to daemon dispatch.
- Publish or forward Mission projection events after authoritative state changes.

Forbidden behavior:

- No arbitrary static `MissionRemote` wrapper as the contract owner.
- No deep `entities/Mission/MissionRemoteContract` schema ownership.
- No route handlers constructing Mission runtime snapshots by hand.
- No `DaemonGateway.entities.readMissionControl` as the component-facing Mission API.
- No client reconciliation that depends on command responses carrying a full runtime snapshot.

### Mission Relationship To Stage, Task, Artifact, And AgentSession

Mission is the aggregate root for workflow projection and invariant enforcement. Stage, Task, Artifact, and AgentSession are not route-local contexts or action-filter inputs; they are first-class child entities at the contract and client-mirror boundary.

That means:

- Mission snapshots include child snapshots so Airport can hydrate mirrored Stage, Task, Artifact, and AgentSession instances.
- Stage, Task, Artifact, and AgentSession have stable typed entity references.
- Stage, Task, Artifact, and AgentSession expose their own command discovery and command execution methods to Airport.
- The daemon may implement those child entity methods by resolving the owning Mission aggregate internally, but the external contract boundary is the child entity.
- UI components must never compose `{ stageId, taskId, artifactPath, sessionId }` action contexts just to discover actions.
- Terminal streaming remains a runtime transport concern; AgentSession projection events identify session state, while socket/PTY routes carry stream bytes.

The transitional `Mission.listActions(context)` shape is allowed only as a temporary bridge while the child entity command contracts are introduced. It is not the target architecture.

## Child Entity Command Architecture

The target operator command model is entity-owned.

Every entity that can appear in an actionbar implements the same conceptual browser-facing capability:

```ts
type ActionableEntity = {
  readonly entityName: string;
  readonly entityId: string;
  listCommands(): Promise<EntityCommandDescriptor[]>;
  executeCommand(commandId: string, input?: unknown): Promise<void>;
};
```

`EntityActionbar` receives an `ActionableEntity` and renders that entity's commands. It must not know about Mission, Stage, Task, Artifact, AgentSession, scopes, target ids, action contexts, workflow stages, artifact paths, or session ids. The entity is the boundary.

### Schema Ownership

Stage, Task, Artifact, and AgentSession are first-class schema owners. Their public identity, reference, snapshot, command discovery, command execution, acknowledgement, and remote payload/result schemas must live in dedicated schema modules rather than being added as Mission-owned schema bulk.

Required canonical schema modules:

- `packages/core/src/schemas/Stage.ts`
- `packages/core/src/schemas/Task.ts`
- `packages/core/src/schemas/Artifact.ts`
- `packages/core/src/schemas/AgentSession.ts`

`packages/core/src/schemas/Mission.ts` may import and compose those schemas because Mission snapshots include child projections. Mission must not be the contract owner for child entity command surfaces. This is the distinction that keeps Mission as the aggregate/invariant authority without turning it into a schema dumping ground.

`packages/core/src/schemas/EntityRemote.ts` owns only generic remote primitives such as entity invocation, command descriptor, command input descriptor, command list snapshot, and acknowledgement base schemas.

### Entity References

Child entity remotes use typed references instead of contextual filtering objects.

```ts
type EntityReference =
  | { entity: "Mission"; missionId: string; repositoryRootPath?: string }
  | { entity: "Stage"; missionId: string; stageId: string; repositoryRootPath?: string }
  | { entity: "Task"; missionId: string; taskId: string; repositoryRootPath?: string }
  | { entity: "Artifact"; missionId: string; artifactId: string; repositoryRootPath?: string }
  | { entity: "AgentSession"; missionId: string; sessionId: string; repositoryRootPath?: string };
```

The current `{ entity, method, payload }` remote shape may be retained if references are encoded in strict method payloads. The target contract, however, is reference-shaped: the caller invokes behavior on a specific entity, not on a Mission-wide action list with filters.

### Entity Commands

`EntityCommandDescriptor` is the canonical UI command contract.

```ts
type EntityCommandDescriptor = {
  commandId: string;
  label: string;
  disabled: boolean;
  disabledReason?: string;
  variant?: "default" | "destructive";
  iconHint?: string;
  confirmation?: {
    required: boolean;
    prompt?: string;
  };
  input?: EntityCommandInputDescriptor;
};
```

Command descriptors are already scoped to the entity that returned them. No client filtering is required. If a command is not relevant to an entity, it is not returned by that entity's `listCommands` method. Disabled commands may be returned only when they explain meaningful state, such as why a ready task cannot start.

### Stage Source Entity Boundary

`Stage` owns stage identity, lifecycle, task membership, artifact membership, and stage-level workflow commands.

Required methods:

| Method | Kind | Payload | Result |
| --- | --- | --- | --- |
| `read` | query | `StageIdentityPayload` | `StageSnapshot` |
| `listCommands` | query | `StageIdentityPayload` | `EntityCommandListSnapshot` |
| `executeCommand` | command | `StageIdentityPayload & { commandId, input? }` | `EntityCommandAcknowledgement` |

The initial stage commands include generated-task creation when the workflow policy exposes it. The Stage handler resolves the owning Mission aggregate internally and delegates policy enforcement to Mission/workflow collaborators.

### Task Source Entity Boundary

`Task` owns task identity, lifecycle, launch intent, completion, reopening, corrective rework, launch policy, and relationship to agent sessions.

Required methods:

| Method | Kind | Payload | Result |
| --- | --- | --- | --- |
| `read` | query | `TaskIdentityPayload` | `TaskSnapshot` |
| `listCommands` | query | `TaskIdentityPayload` | `EntityCommandListSnapshot` |
| `executeCommand` | command | `TaskIdentityPayload & { commandId, input? }` | `EntityCommandAcknowledgement` |

The initial task commands are `start`, `complete`, `reopen`, `rework`, `sendBack`, `enableAutostart`, and `disableAutostart` where policy allows them. The Task command handler must not expose Mission-wide action filtering to Airport.

### Artifact Source Entity Boundary

`Artifact` owns artifact identity, file path metadata, stage/task association, document read behavior, document write behavior, and artifact-level review or correction commands when workflow policy exposes them.

Required methods:

| Method | Kind | Payload | Result |
| --- | --- | --- | --- |
| `read` | query | `ArtifactIdentityPayload` | `ArtifactSnapshot` or `ArtifactDocumentSnapshot` depending on method |
| `readDocument` | query | `ArtifactIdentityPayload` | `ArtifactDocumentSnapshot` |
| `writeDocument` | command | `ArtifactIdentityPayload & { content }` | `ArtifactDocumentSnapshot` |
| `listCommands` | query | `ArtifactIdentityPayload` | `EntityCommandListSnapshot` |
| `executeCommand` | command | `ArtifactIdentityPayload & { commandId, input? }` | `EntityCommandAcknowledgement` |

Artifact identity must not be an untyped arbitrary file path in the UI. The schema may include a canonical path, but the entity reference must be stable and validated.

### AgentSession Source Entity Boundary

`AgentSession` owns session identity, lifecycle, prompt behavior, command behavior, cancellation, termination, completion, terminal attachment metadata, and session-level command discovery.

Required methods:

| Method | Kind | Payload | Result |
| --- | --- | --- | --- |
| `read` | query | `AgentSessionIdentityPayload` | `AgentSessionSnapshot` |
| `listCommands` | query | `AgentSessionIdentityPayload` | `EntityCommandListSnapshot` |
| `executeCommand` | command | `AgentSessionIdentityPayload & { commandId, input? }` | `EntityCommandAcknowledgement` |
| `sendPrompt` | command | `AgentSessionIdentityPayload & { prompt }` | `EntityCommandAcknowledgement` |
| `sendCommand` | command | `AgentSessionIdentityPayload & { command }` | `EntityCommandAcknowledgement` |

Terminal input/output remains stream transport. Session command methods do not return terminal stream data.

### Airport EntityActionbar

The target Actionbar is entity-agnostic:

- It accepts an `ActionableEntity`.
- It calls `entity.listCommands()`.
- It renders command descriptors.
- It calls `entity.executeCommand(commandId, input)`.
- It handles pending, confirmation, input collection, and local errors.
- It refreshes or lets projection events reconcile after command execution.

Forbidden Actionbar behavior:

- No `scope` prop.
- No `stageId`, `taskId`, `artifactPath`, or `sessionId` props.
- No Mission-specific remote calls.
- No local target filtering.
- No ordering policy beyond preserving source order unless the descriptor explicitly carries presentation order.

### Command Policy Ownership

The workflow and Mission aggregate remain the internal source of truth for command policy. DRY means command eligibility rules are not duplicated across child entities. Child entity handlers resolve the owning Mission aggregate and ask focused collaborators for commands applicable to that entity reference.

The clean layering is:

- Child entity contract owns external identity and method shape.
- Mission aggregate owns workflow invariants and mutation authority.
- Shared command policy collaborators derive command descriptors from Mission state and an entity reference.
- Airport mirrors expose entity-shaped methods to components.
- EntityActionbar renders commands without domain knowledge.
- Direct terminal streaming remains a runtime transport concern; AgentSession projection events should identify session state, while socket/PTY routes carry stream bytes.

### Stage

`Stage` owns stage identity, lifecycle, task membership, and artifact membership.

Stage is projected by Mission and may be implemented internally by resolving the owning Mission aggregate, but its public schema and remote contract live under the Stage entity. Stage command discovery and execution are Stage methods, not Mission action filters.

### Task

`Task` owns task identity, lifecycle transitions, launch intent, completion, reopening, and relationship to agent sessions.

Task command discovery and execution are Task methods. The Task handler may resolve Mission internally because the workflow engine validates and applies task transitions in the mission runtime document, but Airport and daemon callers address a Task entity contract directly.

### Artifact

`Artifact` owns artifact identity, path metadata, stage/task association, document read behavior, and document write behavior when editing is allowed.

Artifact document reads, writes, and artifact-level commands are Artifact methods. The Artifact schema owns stable artifact identity and may expose canonical path metadata as data, but callers must not use an untyped file path as the entity boundary.

### AgentSession

`AgentSession` owns session identity, lifecycle, prompt behavior, command behavior, cancellation, termination, completion, and terminal attachment metadata.

AgentSession command discovery, prompt sending, command sending, cancellation, termination, and completion are AgentSession methods. The handler may coordinate through Mission/runtime internals, but the public contract is AgentSession-owned. Terminal socket input/output remains runtime transport, not entity command response data.

## SSE Projection Contract

SSE is the projection channel for authoritative state changes.

### Rules

- The daemon emits projection events after authoritative state changes.
- The browser subscribes through the existing runtime events route or its cleaned replacement.
- Event envelopes are validated with shared schemas.
- Client mirrors reconcile state from events.
- Command responses do not perform cross-entity reconciliation.

### Required Projection Events

The final event set may evolve, but it must express entity-shaped changes rather than route-local view models.

Initial required categories:

- Repository snapshot changed.
- Mission snapshot changed.
- Mission actions changed.
- Stage snapshot changed.
- Task snapshot changed.
- Artifact snapshot changed.
- AgentSession snapshot changed.
- Terminal/session output changed where streaming transport requires it.

### Mission Projection Events

Mission migration requires projection events that are specific enough for client mirrors to reconcile without command-response snapshots.

Required Mission event payload categories:

- `mission.snapshot.changed` carries a validated `MissionSnapshot`.
- `mission.actions.changed` carries a validated action-list projection for one mission.
- `stage.snapshot.changed` carries a validated Stage child projection when a narrower update is sufficient.
- `task.snapshot.changed` carries a validated Task child projection when task lifecycle changes.
- `artifact.snapshot.changed` carries a validated Artifact child projection when document or artifact metadata changes.
- `agentSession.snapshot.changed` carries a validated AgentSession child projection when session lifecycle or metadata changes.
- `agentSession.terminal.output` or the existing terminal stream events carry terminal bytes and terminal handles only.

The event schema may keep a compact envelope, but `payload` must stop being untyped for entity projections. Entity projection payloads must be parsed with shared schemas before emission and before browser reconciliation.

## Airport Client Contract

Airport web presents entity mirrors to components.

### Application Container

`AirportApplication` owns session-long client state:

- Repository mirrors.
- Mission mirrors.
- Active repository selection.
- Active mission selection.
- Runtime/SSE subscriptions.
- Hydration and reconciliation methods.

It is a client application container, not an alternate backend domain layer.

### Component Rules

Components may:

- Read mirrored entity state.
- Call entity methods.
- Subscribe through entity-owned observation APIs.
- Render pending/error/success UI state.

Components must not:

- Import SvelteKit remote functions for business actions.
- Import daemon or node modules.
- Instantiate daemon transports.
- Fetch backend-backed documents, issues, actions, commands, or snapshots directly.
- Compose entity remote payloads manually.

### Client Entity Rules

Client entities may:

- Store reactive snapshots.
- Parse data with shared schemas.
- Call generic query/command remotes.
- Expose domain-shaped methods.
- Reconcile from query results and SSE projection events.

Client entities must not:

- Become authoritative.
- Define backend-only business rules.
- Depend on route-local remotes.
- Depend on deep core entity files.

## Package Export Contract

`packages/core/package.json` exposes minimal stable entrypoints only.

Required public exports:

- `.`
- `./schemas`
- `./browser`
- `./node`
- `./daemon`

Forbidden public exports:

- `./airport/runtime`
- `./entities/*Remote*`
- `./entities/Mission/MissionRemoteContract`
- wildcard `./*`

All web imports must use stable public exports. Browser-reachable files must not import `@flying-pillow/mission-core/node` or daemon-only modules.

## Implementation Plan

### Phase 1: Replace Contract Surface

1. Create canonical Repository schemas in `packages/core/src/schemas/Repository.ts`.
2. Move Repository data, input, mission reference, snapshot, method payload, and method result schemas into that file.
3. Create `packages/core/src/schemas/EntityRemote.ts` for generic invocation and acknowledgement schemas.
4. Create or complete `RuntimeEvents.ts` for SSE envelope and projection schemas.
5. Move Mission runtime snapshot schemas out of `airport/runtime.ts` only as far as Repository snapshots require.
6. Update `packages/core/src/schemas/index.ts` to export the canonical schema surface.
7. Remove schema ownership from `packages/core/src/airport/runtime.ts`.

### Phase 2: Make Repository Daemon-Authoritative

1. Update `packages/core/src/entities/Repository/Repository.ts` to import only canonical shared schemas.
2. Remove `RepositorySchema.ts` as a wrapper layer.
3. Remove `RepositoryRemote.ts` as a contract owner.
4. Keep Repository domain behavior in the `Repository` class.
5. Keep collection behavior in `Repositories`.
6. Remove duplicate validation where it obscures the boundary, while preserving one strict validation point per daemon-callable method.

### Phase 3: Replace Dynamic Dispatch

1. Replace `ENTITY_MODELS` in `packages/core/src/daemon/entityRemote.ts` with explicit entity dispatchers.
2. Implement the explicit Repository dispatcher first.
3. Dispatch static Repository methods explicitly.
4. Resolve Repository instances explicitly for instance methods.
5. Parse payloads before execution.
6. Parse results after execution.
7. Delete generic result normalization.
8. Bump daemon `PROTOCOL_VERSION`.

### Phase 4: Clean Airport Repository Mirror

1. Update the browser Repository mirror to import from `@flying-pillow/mission-core/schemas`.
2. Remove deep imports from entity remote contract files.
3. Keep `Repository.find`, `Repository.add`, `Repository.read`, issue queries, and mission-start methods behind the Repository mirror.
4. Make mission-start methods handle acknowledgement and route derivation only.
5. Reconcile broader mission/workflow state only from query snapshots or SSE events.

### Phase 5: Remove Transitional Remote Layers

1. Remove route-specific Repository issue remotes after callers use the Repository mirror.
2. Remove route-specific Repository mission remotes after callers use the Repository mirror.
3. Remove old airport remotes after active data loading uses entity queries and SSE.
4. Reduce `DaemonGateway` to non-entity infrastructure.
5. Keep `EntityProxy` as the generic daemon forwarding boundary.

### Phase 6: Tighten Package Surface

1. Remove wildcard package export.
2. Remove deep entity remote package exports.
3. Remove `./airport/runtime` package export.
4. Add or keep `./schemas` as the canonical schema export.
5. Update all imports to stable entrypoints.
6. Verify browser bundle boundaries.

### Phase 7: Extend After Repository

Repository is stable enough for Mission to proceed:

1. Create canonical Mission schemas in `packages/core/src/schemas/Mission.ts`.
2. Move Mission identity, snapshot, child projection, action, document, worktree, payload, result, and acknowledgement schemas out of deep entity remote files and route-local files.
3. Refactor `Mission` so daemon-callable behavior is owned by the entity or focused Mission collaborators instead of `MissionRemote` as a parallel contract owner.
4. Add explicit Mission query and command handlers to daemon entity dispatch.
5. Convert Mission commands to acknowledgement or source-local result semantics.
6. Route Mission read/control/action/document/worktree behavior through generic entity remotes where it is request-response behavior.
7. Keep SSE and terminal/socket streams as runtime transports, but validate entity projection payloads through shared schemas.
8. Update the Airport Mission mirror, Task mirror, Artifact mirror, AgentSession mirror, and application container to reconcile from Mission query snapshots and SSE projection events.
9. Remove route-local Mission runtime APIs once their behavior is covered by Mission entity methods or streaming-only transports.
10. Promote Stage, Task, Artifact, and AgentSession to direct daemon-callable entities only after Mission's aggregate boundary is stable.

### Phase 8: Mission Entity Contract

1. Add `missionEntityName`, `missionIdentityPayloadSchema`, `missionSnapshotSchema`, `missionCommandAcknowledgementSchema`, and method-specific payload/result schema maps to `packages/core/src/schemas/Mission.ts`.
2. Make `packages/core/src/schemas/index.ts` export the Mission schema surface.
3. Remove `packages/core/src/entities/Mission/MissionRemoteContract.ts` instead of keeping it as a compatibility wrapper.
4. Move or alias existing `MissionRuntime` snapshot schemas only as an implementation step; the target public contract is `MissionSnapshot`, not `MissionRuntimeSnapshot`.
5. Keep terminal socket schemas out of the Mission entity contract unless they describe AgentSession terminal metadata rather than stream transport.

### Phase 9: Mission Daemon Authority

1. Replace `MissionRemote` as the daemon-callable contract owner.
2. Keep runtime loading/disposal in a focused collaborator used by Mission methods or Mission dispatch handlers.
3. Implement explicit Mission handlers in `packages/core/src/daemon/entityRemote.ts` for `read`, `readControl`, `listActions`, `readDocument`, `readWorktree`, `command`, `taskCommand`, `sessionCommand`, `executeAction`, and `writeDocument`.
4. Parse each payload before execution and each result after execution.
5. Return acknowledgement schemas for mission, task, session, and action commands.
6. Publish or forward validated projection events after state changes.
7. Bump daemon `PROTOCOL_VERSION` when daemon RPC behavior or contracts change.

### Phase 10: Airport Mission Mirror

1. Update `Mission.svelte.ts` so command methods apply pending state and wait for SSE/query reconciliation instead of applying command-returned `MissionRuntimeSnapshot` values.
2. Update `MissionCommandTransport.ts` and `MissionRuntimeTransport.ts` to import Mission schemas from `@flying-pillow/mission-core/schemas` and call only generic query/command remotes for request-response behavior.
3. Replace `getMissionControl`, `getMissionActions`, `readMissionDocument`, `writeMissionDocument`, and `getMissionWorktree` route fetches with Mission entity query/command methods.
4. Keep terminal and event streaming transports separate from entity source commands.
5. Ensure components use Mission, Stage, Task, Artifact, and AgentSession mirrors rather than route remotes, fetches, or manual payload composition.

### Phase 11: Remove Mission Transitional Layers

1. Remove or reduce `packages/core/src/entities/Mission/MissionRemote.ts` after Mission entity methods and daemon dispatch own behavior.
2. Remove Mission schema ownership from `packages/core/src/airport/runtime.ts`.
3. Remove route-local Mission request-response APIs that duplicate entity remotes.
4. Keep only streaming routes for SSE and terminal/socket output where request-response remotes are the wrong transport.
5. Remove manual Mission parsers from Airport web once shared schemas cover the trust boundaries.

## File Matrix

### Core Files

| File | Target Action |
| --- | --- |
| `packages/core/src/schemas/Repository.ts` | Canonical Repository schema and method contract owner |
| `packages/core/src/schemas/EntityRemote.ts` | Canonical generic entity invocation contract owner |
| `packages/core/src/schemas/RuntimeEvents.ts` | Canonical SSE event contract owner |
| `packages/core/src/schemas/Mission.ts` | Canonical Mission schema and method contract owner |
| `packages/core/src/schemas/MissionRuntime.ts` | Fold into Mission schema contract or reduce to execution-internal schemas |
| `packages/core/src/schemas/index.ts` | Public schema barrel |
| `packages/core/src/airport/runtime.ts` | Decompose and remove schema ownership |
| `packages/core/src/airport/entityRemote.ts` | Remove or reduce after `schemas/EntityRemote.ts` owns the contract |
| `packages/core/src/entities/Repository/Repository.ts` | Repository domain authority |
| `packages/core/src/entities/Repository/Repositories.ts` | Repository collection authority |
| `packages/core/src/entities/Repository/RepositorySchema.ts` | Remove as wrapper layer |
| `packages/core/src/entities/Repository/RepositoryRemote.ts` | Remove as contract owner |
| `packages/core/src/entities/Mission/Mission.ts` | Mission domain authority and entity projection owner |
| `packages/core/src/entities/Mission/MissionRemote.ts` | Remove as parallel daemon-callable contract owner after migration |
| `packages/core/src/daemon/entityRemote.ts` | Replace dynamic dispatch with explicit dispatchers |
| `packages/core/src/daemon/runDaemonMain.ts` | Import canonical schemas and route entity RPCs to explicit dispatch |
| `packages/core/src/daemon/protocol/contracts.ts` | Align entity request/response types and bump protocol version |
| `packages/core/package.json` | Keep minimal stable exports only |

### Airport Web Files

| File | Target Action |
| --- | --- |
| `apps/airport/web/src/routes/api/entities/remote/query.remote.ts` | Keep as thin generic query gateway |
| `apps/airport/web/src/routes/api/entities/remote/command.remote.ts` | Keep as thin generic command gateway |
| `apps/airport/web/src/routes/api/entities/remote/dispatch.ts` | Import canonical entity remote schemas |
| `apps/airport/web/src/lib/server/daemon/entity-proxy.ts` | Keep as daemon forwarding boundary |
| `apps/airport/web/src/lib/server/daemon/daemon-gateway.ts` | Reduce to non-entity infrastructure |
| `apps/airport/web/src/lib/client/Application.svelte.ts` | Keep application container and remove legacy/commented architecture |
| `apps/airport/web/src/lib/components/entities/Repository/Repository.svelte.ts` | Use canonical schemas and source acknowledgement command semantics |
| `apps/airport/web/src/lib/components/entities/Mission/Mission.svelte.ts` | Use canonical Mission schemas, acknowledgement command semantics, and SSE/query reconciliation |
| `apps/airport/web/src/lib/components/entities/Task/Task.svelte.ts` | Route task methods through owning Mission mirror until Task becomes a source entity |
| `apps/airport/web/src/lib/components/entities/Artifact/Artifact.svelte.ts` | Route document methods through owning Mission mirror until Artifact becomes a source entity |
| `apps/airport/web/src/lib/components/entities/AgentSession/AgentSession.svelte.ts` | Route session methods through owning Mission mirror until AgentSession becomes a source entity |
| `apps/airport/web/src/lib/client/runtime/transport/MissionRuntimeTransport.ts` | Use generic Mission entity query for snapshots and keep SSE as projection transport |
| `apps/airport/web/src/lib/client/runtime/transport/MissionCommandTransport.ts` | Use generic Mission entity commands and acknowledgement/source-local result schemas |
| `apps/airport/web/src/routes/api/runtime/events/+server.ts` | Keep daemon-backed SSE bridge and validate shared event envelopes |
| `apps/airport/web/src/routes/api/runtime/missions/[missionId]/+server.ts` | Remove or reduce after Mission `read` query owns request-response snapshot reads |
| `apps/airport/web/src/routes/api/runtime/missions/[missionId]/control/+server.ts` | Remove or reduce after Mission `readControl` owns request-response control reads |
| `apps/airport/web/src/routes/api/runtime/missions/[missionId]/actions/+server.ts` | Remove or reduce after Mission `listActions` owns request-response action reads |
| `apps/airport/web/src/routes/api/runtime/missions/[missionId]/documents/+server.ts` | Remove or reduce after Mission document query/command methods own document IO |
| `apps/airport/web/src/routes/api/runtime/missions/[missionId]/worktree/+server.ts` | Remove or reduce after Mission `readWorktree` owns request-response worktree reads |
| `apps/airport/web/src/routes/api/runtime/missions/[missionId]/tasks/[taskId]/+server.ts` | Remove or reduce after Mission task commands own request-response task behavior |
| `apps/airport/web/src/routes/api/runtime/missions/[missionId]/sessions/[sessionId]/+server.ts` | Remove or reduce after Mission session commands own request-response session behavior |
| `apps/airport/web/src/routes/api/runtime/missions/[missionId]/terminal/+server.ts` | Keep only if it remains streaming/terminal transport rather than entity command behavior |
| `apps/airport/web/src/routes/(app)/repository/[repositoryId]/issue.remote.ts` | Remove after Repository mirror owns issue methods |
| `apps/airport/web/src/routes/(app)/repository/[repositoryId]/mission.remote.ts` | Remove after Repository mirror owns mission-start methods |
| `apps/airport/web/src/routes/(app)/repository/[repositoryId]/missions/[missionId]/mission-page.remote.ts` | Remove after Mission and Repository mirrors own page snapshot assembly |
| `apps/airport/web/src/routes/api/airport/remote.ts` | Remove after generic entity/SSE paths replace active behavior |
| `apps/airport/web/src/routes/api/airport/airport.remote.ts` | Remove after generic entity/SSE paths replace active behavior |
| `apps/airport/web/src/lib/client/runtime/parsers.ts` | Replace manual parsers with shared schemas or remove |

## Verification

### Automated Checks

Run after implementation:

1. `pnpm --filter @flying-pillow/mission-core test`
2. `pnpm --filter @flying-pillow/mission-airport-web test`
3. `pnpm run check:packages`
4. `pnpm run check:web`
5. `pnpm run build:packages`
6. `pnpm run build:web`

### Manual Checks

1. Airport initializes by calling `Repository.find` through the generic entity query path.
2. Repository add/register returns a Repository source result and hydrates the client mirror.
3. Repository open/read returns a `RepositorySnapshot` from the daemon.
4. Repository issue list/detail calls route through Repository mirror methods.
5. Starting a mission from an issue returns source acknowledgement, not broad workflow projection.
6. Starting a mission from a brief returns source acknowledgement, not broad workflow projection.
7. Mission/workflow/task/session changes caused by mission-start or task commands arrive through SSE events.
8. Browser-reachable files do not import `@flying-pillow/mission-core/node`.
9. Browser-reachable files do not import deep `entities/*Remote*` paths.
10. `packages/core/package.json` has no wildcard export.
11. Mission `read` routes through generic entity query and returns a canonical `MissionSnapshot`.
12. Mission task/session/mission/action commands return acknowledgements or source-local results, not broad runtime snapshots.
13. Mission document and worktree request-response behavior routes through Mission entity methods.
14. Mission projection events reconcile Mission, Stage, Task, Artifact, and AgentSession mirrors without command-returned projection snapshots.
15. Terminal/session streaming still works through streaming transports and does not leak into command result contracts.

## Acceptance Criteria

- Repository schemas are canonical under `packages/core/src/schemas`.
- Repository daemon calls are handled through explicit dispatch, not dynamic registry/prototype probing.
- Repository client mirror imports schemas from `@flying-pillow/mission-core/schemas`.
- Query responses are raw schema-validated data.
- Command responses are source acknowledgement or source-local results.
- Cross-entity projections are delivered through SSE.
- `airport/runtime.ts` no longer owns shared entity, method, or event schemas.
- Route-specific Repository remotes are gone from the target architecture.
- Mission schemas are canonical under `packages/core/src/schemas`.
- Mission daemon calls are handled through explicit dispatch, not `MissionRemote` as a parallel contract owner.
- Mission client mirror imports schemas from `@flying-pillow/mission-core/schemas`.
- Mission commands return acknowledgements or source-local results instead of `MissionRuntimeSnapshot` reconciliation payloads.
- Mission request-response routes are removed or reduced once generic entity remotes own reads, actions, documents, and worktree queries.
- Stage, Task, Artifact, and AgentSession mirrors reconcile as Mission child projections until they become direct source entities.
- Package exports are minimal and stable.
- No fallback, compatibility, alias, or normalization layer remains in the target implementation.
