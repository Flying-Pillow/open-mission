---
title: "SPEC: #29 - Architectural Reset: Strict OOD Entity Architecture For Airport And Daemon"
artifact: "spec"
createdAt: "2026-04-22T14:54:07.971Z"
updatedAt: "2026-04-26T00:00:00.000+00:00"
stage: "spec"
---

Branch: mission/29-architectural-reset-strict-ood-entity-architectu

## Mission Intent

Mission `29` resets Airport and daemon communication around strict object-oriented mirrored entities.

The daemon is the authority. It owns entity identity, entity state, entity behavior, validation, persistence, side effects, and event publication. Airport web owns client-side mirrored entity instances, UI lifecycle, local pending/error state, and reconciliation of daemon projections.

The target architecture keeps the useful part of the reference application in `/repositories/Flying-Pillow/flying-pillow/apps/app`: client entities call a small generic remote boundary, and backend entities execute the real behavior. It deliberately does not copy the reference application's dynamic entity registry, metadata model system, generic UI/action metadata, autosave/history stack, or broad result-envelope machinery.

The first implementation target is `Repository`. `Mission`, `Stage`, `Task`, `Artifact`, and `AgentSession` follow only after the Repository contract proves the architecture. This mission must prefer a small, strict, explicit foundation over a broad partially migrated system.

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
| `MissionRuntime.ts` or `Mission.ts` | Mission snapshot schemas required by Repository snapshots and Mission mirrors |
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

The broader entity set remains the target, but it is not implemented before Repository proves the strict foundation.

### Mission

`Mission` owns mission lifecycle, mission status, workflow coordination, stage membership, task membership, artifact membership, and agent-session membership.

Mission commands must migrate to source acknowledgement plus SSE projection. Today, broad `MissionRuntimeSnapshot` command responses are tolerated only as current-state evidence, not as target architecture.

### Stage

`Stage` owns stage identity, lifecycle, task membership, and artifact membership.

### Task

`Task` owns task identity, lifecycle transitions, launch intent, completion, reopening, and relationship to agent sessions.

### Artifact

`Artifact` owns artifact identity, path metadata, stage/task association, document read behavior, and document write behavior when editing is allowed.

### AgentSession

`AgentSession` owns session identity, lifecycle, prompt behavior, command behavior, cancellation, termination, completion, and terminal attachment metadata.

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

After Repository is stable:

1. Migrate `GitHubRepository` or fold it into Repository import/clone behavior.
2. Migrate Mission commands to command acknowledgement plus SSE projection.
3. Promote Stage, Task, Artifact, and AgentSession projection contracts.
4. Replace remaining manual parsers with shared schemas.
5. Remove obsolete runtime routes that duplicate entity remotes.

## File Matrix

### Core Files

| File | Target Action |
| --- | --- |
| `packages/core/src/schemas/Repository.ts` | Canonical Repository schema and method contract owner |
| `packages/core/src/schemas/EntityRemote.ts` | Canonical generic entity invocation contract owner |
| `packages/core/src/schemas/RuntimeEvents.ts` | Canonical SSE event contract owner |
| `packages/core/src/schemas/index.ts` | Public schema barrel |
| `packages/core/src/airport/runtime.ts` | Decompose and remove schema ownership |
| `packages/core/src/airport/entityRemote.ts` | Remove or reduce after `schemas/EntityRemote.ts` owns the contract |
| `packages/core/src/entities/Repository/Repository.ts` | Repository domain authority |
| `packages/core/src/entities/Repository/Repositories.ts` | Repository collection authority |
| `packages/core/src/entities/Repository/RepositorySchema.ts` | Remove as wrapper layer |
| `packages/core/src/entities/Repository/RepositoryRemote.ts` | Remove as contract owner |
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
| `apps/airport/web/src/routes/api/runtime/events/+server.ts` | Keep daemon-backed SSE bridge and validate shared event envelopes |
| `apps/airport/web/src/routes/(app)/repository/[repositoryId]/issue.remote.ts` | Remove after Repository mirror owns issue methods |
| `apps/airport/web/src/routes/(app)/repository/[repositoryId]/mission.remote.ts` | Remove after Repository mirror owns mission-start methods |
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

## Acceptance Criteria

- Repository schemas are canonical under `packages/core/src/schemas`.
- Repository daemon calls are handled through explicit dispatch, not dynamic registry/prototype probing.
- Repository client mirror imports schemas from `@flying-pillow/mission-core/schemas`.
- Query responses are raw schema-validated data.
- Command responses are source acknowledgement or source-local results.
- Cross-entity projections are delivered through SSE.
- `airport/runtime.ts` no longer owns shared entity, method, or event schemas.
- Route-specific Repository remotes are gone from the target architecture.
- Package exports are minimal and stable.
- No fallback, compatibility, alias, or normalization layer remains in the target implementation.
