---
title: "SPEC: #29 - Architectural Reset: Strict OOD Entity Architecture For Airport And Daemon"
artifact: "spec"
createdAt: "2026-04-22T14:54:07.971Z"
updatedAt: "2026-04-22T20:18:13.367+00:00"
stage: "spec"
---

Branch: mission/29-architectural-reset-strict-ood-entity-architectu

## Mission Intent

- Mission `29` resets the Airport and Daemon architecture so `packages/core` becomes the single authoritative home for backend entities, business rules, and shared contracts.
- The authoritative entity set is `Repository`, `Mission`, `Stage`, `Task`, `Artifact`, and `AgentSession`. Those names must exist as first-class concepts in both the core contracts and the Airport client model.
- Airport web must stop treating `appContext` as a plain selection/state bag. It becomes a singleton application container that owns the active frontend entity instances and exposes them as the only component-facing API.
- SvelteKit remote functions remain the required RPC boundary for commands, queries, and forms. Components do not call remote functions, runtime routes, or ad hoc fetch helpers directly; entity instances do.
- The reference architecture in `/repositories/Flying-Pillow/flying-pillow/apps/app` is the target shape: singleton application/container objects, first-class client and server entity classes, and generic remote-function gateways that dispatch entity methods instead of route-specific component orchestration.

## Architecture

- `packages/core` remains the system authority. Repository state, mission lifecycle, workflow stage/task state, artifact identity, and agent-session behavior are modeled there first and projected outward as entity-shaped contracts.
- `Repository` becomes the aggregate root for repository-scoped behavior: repository metadata, available missions, issue-backed mission creation, and resolution of the selected mission.
- `Mission` remains the aggregate root for mission lifecycle but is decomposed around explicit child entities: `Stage`, `Task`, `Artifact`, and `AgentSession`. Workflow-engine state is an implementation detail behind those entities rather than the client-facing contract.
- `Stage` is promoted from a nested DTO slice into a first-class domain concept that owns stage identity, lifecycle, task membership, and artifact membership.
- `Task` owns task lifecycle transitions and launch intent. `Artifact` owns artifact identity, path, load/save behavior, and stage/task association. `AgentSession` owns session lifecycle, prompt/command behavior, and terminal attachment behavior.
- `packages/core/src/airport/runtime.ts` becomes the canonical Airport contract surface for entity-shaped DTOs and validators. Those DTOs mirror the entity model rather than leaking raw `OperatorStatus`, workflow document structure, or storage-oriented `mission.json` shapes.
- `AirportWebGateway` stays thin. It translates remote-function or streaming requests into core API calls and returns validated DTOs; it does not become a second domain layer and does not assemble alternate view-model concepts.
- The Airport client mirrors the same entity graph and should converge on the reference app’s layering: a singleton app/application object, a session-wide context/container object, shared client entity base behavior, and concrete entity subclasses for repository/mission/stage/task/artifact/session concepts.
- `appContext` is therefore not just a selected-IDs store. It is the Airport-specific analogue of the reference app’s session-wide client container, owning active `Repository`, `Mission`, `Stage`, `Task`, `Artifact`, and `AgentSession` instances plus shell-only server state (`daemon`, GitHub auth/user).
- Route components hydrate or synchronize `appContext`, but they do not instantiate transport classes, compose command payloads, or fetch documents, terminals, actions, or issues directly. That behavior moves into the entity instances held by `appContext`.
- Remote-function calls for repository issues, mission creation, mission commands, task commands, session commands, and artifact document queries/forms are encapsulated inside entity methods or tightly coupled entity-runtime helpers.
- The simplification relative to the reference app is scope, not pattern: Airport does not need the full generic data-platform stack, but it should copy the same architectural law that entity methods call a stable remote boundary, the remote boundary resolves entity behavior server-side, and components never orchestrate RPC manually.
- The preferred RPC target is a small generic entity-method remote surface modeled after the reference app’s `query.remote`, `command.remote`, and `form.remote` files, rather than a growing set of route-specific remotes per UI feature. If a few explicit remotes remain during migration, they are transitional and should converge on that generic entity-dispatch pattern.
- Streaming-only transport such as SSE or websocket terminal feeds may remain as specialized runtime endpoints, but those endpoints are still reached through entity-owned methods instead of directly from presentation components.

## Signatures

- `packages/core/src/repository/Repository.ts` **(new)**: authoritative repository entity with repository identity, selected mission resolution, issue enumeration hooks, and mission-creation entrypoints.
- `packages/core/src/mission/Mission.ts`: authoritative mission aggregate exposing first-class `Stage`, `Task`, `Artifact`, and `AgentSession` accessors instead of making workflow snapshots the primary external shape.
- `packages/core/src/mission/Stage.ts` **(new)**: stage entity with `stageId`, lifecycle, `listTasks()`, and `listArtifacts()` responsibilities.
- `packages/core/src/mission/MissionTask.ts`: task entity continues to own task transitions and session launch semantics, but aligns its public contract with the new explicit `Task` entity boundary.
- `packages/core/src/mission/Artifact.ts`: artifact entity expands from file-materialization helper into the authoritative artifact object used for stage/task/product artifact identity and document access.
- `packages/core/src/mission/MissionSession.ts`: agent-session entity remains authoritative for session lifecycle and prompt/command/terminal operations.
- `packages/core/src/airport/runtime.ts`: defines the entity DTOs and zod schemas consumed by Airport web, including repository, mission, stage, task, artifact, session, and app-context-facing runtime snapshots.
- `packages/core/src/client/DaemonMissionApi.ts` and `packages/core/src/daemon/protocol/contracts.ts`: align daemon/client contracts with the entity vocabulary so the daemon boundary speaks in entity-shaped payloads rather than mixed operator-status and route-local convenience structures.
- `apps/airport/web/src/lib/client/Application.svelte.ts` **(new or extracted)**: Airport application singleton analogous to the reference app’s client `Application`, responsible for wiring entity registries/runtime collaborators and exposing the singleton app surface.
- `apps/airport/web/src/lib/client/context/app-context.svelte.ts`: session-wide application container analogous to the reference app’s `ClientContext`, with active entity instances, synchronization methods, and lifecycle boundaries. It remains the only component-facing access point for backend-backed state and actions.
- `apps/airport/web/src/lib/client/entities/Entity.svelte.ts` **(new or extracted)**: shared client entity base class analogous to the reference app’s base `Entity`, so concrete entities share command/query/form execution, reconciliation, state, and lifecycle conventions instead of each reimplementing transport behavior ad hoc.
- `apps/airport/web/src/lib/client/entities/Repository.ts`: repository entity owns repository-scoped issue queries, mission creation, mission selection hydration, and access to the selected `Mission`.
- `apps/airport/web/src/lib/client/entities/Mission.ts`: mission entity owns mission refresh, mission actions, task/session mutation, stage/task/artifact/session reconciliation, and runtime subscription entrypoints.
- `apps/airport/web/src/lib/client/entities/Stage.ts`, `Task.ts`, and `AgentSession.ts`: remain first-class client entities but align their APIs with the stricter core model and move any remaining transport knowledge behind entity-owned collaborators.
- `apps/airport/web/src/lib/client/entities/Artifact.ts` **(new)**: client artifact entity owning document load/save behavior and artifact metadata so viewer/editor components stop fetching documents directly.
- `apps/airport/web/src/routes/api/entities/remote/query.remote.ts` **(new)**: generic query dispatcher modeled after the reference app’s `qry`, routing entity query methods through one stable remote boundary.
- `apps/airport/web/src/routes/api/entities/remote/command.remote.ts` **(new)**: generic command dispatcher modeled after the reference app’s `cmd`, routing entity mutation methods through one stable remote boundary.
- `apps/airport/web/src/routes/api/entities/remote/form.remote.ts` **(new, if form uploads remain needed)**: generic form dispatcher modeled after the reference app’s `frm`, handling form payload normalization and invoking entity methods.

## Design Boundaries

- `packages/core` is the only authority for entity identity, lifecycle rules, and business behavior. Airport web cannot define alternate domain truth.
- `mission.json` remains storage only. Neither core DTOs nor Airport entities are allowed to mirror storage-oriented shapes just because they are convenient to serialize.
- `AirportWebGateway`, route handlers, and remote functions may validate, route, and translate, but they may not accumulate business rules that belong to `Repository`, `Mission`, `Stage`, `Task`, `Artifact`, or `AgentSession`.
- `appContext` is a containment and lifecycle boundary, not a generic service layer. It can own entity instances and selection state, but behavior belongs on the entities themselves.
- The client-side singleton/container pattern must follow the reference app closely: one long-lived application/container object for the session, reused across route transitions instead of reconstructing entity wiring per page.
- Components may read from `appContext` and call entity methods exposed by it. Components must not import remote functions for business actions, instantiate transport classes, or issue direct fetches for backend-backed commands, queries, forms, or artifact/document access.
- Remote functions should converge toward generic entity-method dispatch, following the reference app, instead of proliferating route-local RPC APIs that mirror component structure.
- If streaming/runtime endpoints remain necessary for SSE, websocket, or terminal transport, they stay transport-only and are invoked through entity methods instead of component-level fetch code.
- No legacy compatibility aliases, fallback entity shapes, or split architecture between daemon/core and web are preserved as part of the target design.

## Implementation Ledger

- Slice 1: define the authoritative backend entity vocabulary and align daemon/client/runtime DTO contracts around `Repository`, `Mission`, `Stage`, `Task`, `Artifact`, and `AgentSession`.
- Slice 2: introduce the reference-style generic entity remote boundary for queries, commands, and forms, then route Airport entity methods through it.
- Slice 3: convert `appContext` from a selection-state bag into a singleton application/container stack that owns active entity instances.
- Slice 4: move repository, mission, task, session, and artifact transport behavior behind shared frontend entity base behavior and concrete entity methods, removing component-level remote/fetch orchestration.
- Slice 5: align mission-control, artifact, actionbar, and terminal UI components so they consume entity/app-context APIs only.

## File Matrix

- `packages/core/src/repository/Repository.ts` **(new)**: introduce the authoritative repository entity instead of leaving repository behavior spread across runtime helpers and web projections.
- `packages/core/src/repository/RepositoryRuntime.ts`: refactor repository-scoped orchestration to use the repository entity as the backend aggregate root.
- `packages/core/src/repository/RepositoryManager.ts`: align repository discovery/loading around the new repository entity boundary.
- `packages/core/src/mission/Mission.ts`: expose mission-owned `Stage`, `Task`, `Artifact`, and `AgentSession` relationships explicitly.
- `packages/core/src/mission/Stage.ts` **(new)**: add the missing first-class backend stage entity.
- `packages/core/src/mission/MissionTask.ts`: align task lifecycle and launch semantics with the stricter entity model.
- `packages/core/src/mission/Artifact.ts`: expand artifact responsibility from file helper to first-class entity contract.
- `packages/core/src/mission/MissionSession.ts`: keep session behavior entity-owned and aligned with the new shared vocabulary.
- `packages/core/src/airport/runtime.ts`: redefine Airport DTO schemas around the entity model and remote-function inputs/outputs.
- `packages/core/src/client/DaemonMissionApi.ts`: align client-facing daemon mission methods with the entity-shaped contracts.
- `packages/core/src/daemon/protocol/contracts.ts`: align daemon protocol payloads and records with the entity vocabulary exported to Airport web.
- `packages/core/src/index.ts`: export the canonical entity and contract surfaces from one place.
- `apps/airport/web/src/lib/server/gateway/AirportWebGateway.server.ts`: keep the SvelteKit server gateway thin while translating between remote functions and the new core entity contracts.
- `apps/airport/web/src/lib/client/Application.svelte.ts` **(new or extracted)**: add the Airport application singleton mirroring the reference app’s application-level wiring.
- `apps/airport/web/src/lib/client/context/app-context.svelte.ts`: replace selection-only state with a singleton entity container.
- `apps/airport/web/src/lib/client/entities/Entity.svelte.ts` **(new or extracted)**: introduce a shared client entity base aligned with the reference app’s entity method execution pattern.
- `apps/airport/web/src/lib/client/entities/Repository.ts`: own repository issue queries, mission creation, and mission hydration behind entity methods.
- `apps/airport/web/src/lib/client/entities/Mission.ts`: own mission commands, runtime refresh, and reconciliation of stages/tasks/artifacts/sessions.
- `apps/airport/web/src/lib/client/entities/Stage.ts`: align stage API with the stricter first-class stage contract.
- `apps/airport/web/src/lib/client/entities/Task.ts`: keep task actions entity-owned and aligned with backend `Task`.
- `apps/airport/web/src/lib/client/entities/AgentSession.ts`: keep session commands and terminal behavior entity-owned.
- `apps/airport/web/src/lib/client/entities/Artifact.ts` **(new)**: move artifact document load/save behavior out of components and into an entity.
- `apps/airport/web/src/lib/client/runtime/AirportClientRuntime.ts`: align the client runtime with app-context-owned entity instances instead of ad hoc route-level construction.
- `apps/airport/web/src/lib/client/runtime/transport/MissionCommandTransport.ts`: either collapse command behavior into entity-owned remote-function collaborators or reduce this file to an implementation detail hidden behind entities.
- `apps/airport/web/src/lib/client/runtime/transport/MissionRuntimeTransport.ts`: keep runtime observation transport behind mission/session entities rather than route components.
- `apps/airport/web/src/lib/index.ts`: export the updated client entity/container surface.
- `apps/airport/web/src/routes/api/entities/remote/query.remote.ts` **(new)**: add the reference-style generic query dispatcher.
- `apps/airport/web/src/routes/api/entities/remote/command.remote.ts` **(new)**: add the reference-style generic command dispatcher.
- `apps/airport/web/src/routes/api/entities/remote/form.remote.ts` **(new, if form uploads remain needed)**: add the reference-style generic form dispatcher.
- `apps/airport/web/src/routes/airport.remote.ts`: either collapse this into the generic entity query boundary or keep it as thin transitional glue while the app converges on entity dispatch.
- `apps/airport/web/src/routes/repository/[repositoryId]/issue.remote.ts`: either collapse this into the generic entity query boundary or keep it as thin transitional glue while the repository entity migrates.
- `apps/airport/web/src/routes/repository/[repositoryId]/mission.remote.ts`: either collapse this into the generic entity command/form boundary or keep it as thin transitional glue while the repository entity migrates.
- `apps/airport/web/src/routes/repository/[repositoryId]/+page.svelte`: stop instantiating transport classes and remote functions directly; hydrate `appContext` with entity instances only.
- `apps/airport/web/src/routes/repository/[repositoryId]/missions/[missionId]/+page.svelte`: stop constructing mission runtime/command transports in the component and consume the singleton entity container instead.
- `apps/airport/web/src/lib/components/entities/Brief/BriefForm.svelte`: stop importing route remote functions directly and submit through repository/entity APIs.
- `apps/airport/web/src/lib/components/entities/Issue/IssueList.svelte`: keep issue loading and start-from-issue actions behind the repository entity.
- `apps/airport/web/src/lib/components/entities/Actionbar/ScopedActionbar.svelte`: remove direct action fetch/execution calls and delegate through mission/task/session entities.
- `apps/airport/web/src/lib/components/entities/Mission/MissionTerminal.svelte`: remove direct terminal fetch/websocket orchestration from the component boundary.
- `apps/airport/web/src/lib/components/entities/AgentSession/AgentSession.svelte`: remove direct session-terminal fetch/websocket orchestration from the component boundary.
- `apps/airport/web/src/lib/components/entities/Artifact/ArtifactViewer.svelte`: stop fetching artifact documents directly and read through the artifact entity.
- `apps/airport/web/src/lib/components/entities/Artifact/ArtifactEditor.svelte`: stop loading/saving artifact documents directly and edit through the artifact entity.
- `apps/airport/web/src/routes/api/runtime/missions/[missionId]/+server.ts`: keep snapshot transport aligned with the entity-shaped mission contract if streaming/runtime endpoints remain necessary.
- `apps/airport/web/src/routes/api/runtime/missions/[missionId]/actions/+server.ts`: keep any remaining action transport thin and entity-aligned.
- `apps/airport/web/src/routes/api/runtime/missions/[missionId]/tasks/[taskId]/+server.ts`: keep any remaining task transport thin and entity-aligned.
- `apps/airport/web/src/routes/api/runtime/missions/[missionId]/sessions/[sessionId]/+server.ts`: keep any remaining session transport thin and entity-aligned.
- `apps/airport/web/src/routes/api/runtime/events/+server.ts`: preserve SSE/runtime-event transport only as a transport detail behind entity-owned observation APIs.
