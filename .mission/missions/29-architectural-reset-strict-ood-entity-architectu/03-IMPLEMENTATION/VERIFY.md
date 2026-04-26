---
title: "VERIFY: #29 - Architectural Reset: Strict OOD Entity Architecture For Airport And Daemon"
artifact: "verify"
createdAt: "2026-04-22T14:54:07.971Z"
updatedAt: "2026-04-26T15:30:00Z"
stage: "implementation"
---

Branch: mission/29-architectural-reset-strict-ood-entity-architectu

## 2026-04-26 - Task 01 Verify Canonical Schema Contracts

Task: `implementation/01-create-canonical-schema-contracts-verify`

### Task 01 Focused Evidence

- `pnpm --filter @flying-pillow/mission-core build` passed.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm vitest run src/routes/api/entities/remote/dispatch.test.ts` from `apps/airport/web` passed: 1 file / 4 tests.
- A targeted schema ownership script passed all checks:
  - Repository payload schemas under `packages/core/src/schemas/Repository.ts` are strict and contain no `.passthrough()` usage.
  - Generic entity invocation schemas under `packages/core/src/schemas/EntityRemote.ts` are strict.
  - Runtime event envelope schema under `packages/core/src/schemas/RuntimeEvents.ts` is strict.
  - `packages/core/src/schemas/index.ts` exports the canonical Repository, EntityRemote, MissionRuntime, RuntimeEvents, and SystemState modules.
  - `packages/core/package.json` exposes `./schemas` with source, type, and build entries.
  - `packages/core/src/airport/runtime.ts` imports Repository, MissionRuntime, and RuntimeEvents schemas from `packages/core/src/schemas` and no longer defines the canonical Repository snapshot, Mission runtime snapshot, or runtime event envelope schemas.
- A filtered `pnpm --filter @flying-pillow/mission-airport-web check` run still exits 1 because the web app has unrelated baseline errors, but the filtered log contains no remaining `@flying-pillow/mission-core/schemas` diagnostics after this verification pass.

### Findings Fixed During Verification

- `apps/airport/web/src/lib/components/entities/Brief/BriefForm.svelte` now derives `BriefInput` and flattened field errors from `missionFromBriefInputSchema` through Zod v4 types.
- `apps/airport/web/src/lib/index.ts` now aliases schema `Mission` and `Repository` types to avoid duplicate exports with the client entity classes.
- `apps/airport/web/src/lib/client/runtime/terminal/TerminalTransportBroker.ts` now uses a valid `import type` form for schema-exported terminal types.

### Remaining Gaps Outside Task 01 Scope

- Full Airport web checking remains blocked by unrelated baseline errors outside the canonical schema contract slice.
- Transitional schema passthrough modules and deeper package export tightening remain for later implementation tasks, especially task 06.

## 2026-04-26 - Task 02 Verify Repository Domain Authority

Task: `implementation/02-make-repository-domain-authoritative-verify`

### Focused Evidence

- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/entities/Repository/Repository.test.ts` passed: 1 file / 4 tests.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- Repository wrapper ownership scan under `packages/core/src` passed: no active source imports or exports of `RepositorySchema.js` or `RepositoryRemote.js` remain.
- Repository wrapper file scan passed: `packages/core/src/entities/Repository/RepositorySchema.ts` and `packages/core/src/entities/Repository/RepositoryRemote.ts` are removed.
- Repository source import boundary scan passed: Repository entity files no longer import the removed wrappers or `../../airport/runtime.js` for Repository contracts.
- Editor diagnostics reported no errors for the changed Repository files and this verification ledger.

### Task 02 Boundary Evidence

- `Repository.ts` imports Repository payload, result, snapshot, and issue schemas directly from `packages/core/src/schemas/Repository.ts`.
- `Repository.find`, `Repository.add`, `Repository.read`, `listIssues`, `getIssue`, `startMissionFromIssue`, and `startMissionFromBrief` keep one strict validation point at the daemon-callable method boundary.
- Instance methods reject mismatched `repositoryId` or `repositoryRootPath`, preventing daemon-callable payloads from targeting a different Repository instance.
- Issue query outputs and mission-start outputs are parsed with canonical result schemas before returning JSON-safe values.
- `Repositories.register` uses the canonical repository registration input schema while keeping collection behavior in `Repositories`.
- Static review found no daemon dispatch, Airport web, package export, SSE/event wiring, or workflow-engine structured runtime changes made for this verification slice.

### Task 02 Remaining Gaps Outside Scope

- `packages/core/src/daemon/entityRemote.ts` still contains dynamic entity dispatch and generic result normalization; this is intentionally deferred to task 03.
- Airport web mirror cleanup and route-local Repository remote removal remain deferred to task 04.
- Full package export tightening remains deferred to task 06.

## 2026-04-26 - Task 03 Verify Explicit Daemon Entity Dispatch

Task: `implementation/03-replace-daemon-entity-dispatch-verify`

### Task 03 Focused Evidence

- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/daemon/entityRemote.test.ts packages/core/src/entities/Repository/Repository.test.ts` passed: 2 files / 12 tests.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- Static forbidden-pattern scan of `packages/core/src/daemon/entityRemote.ts` passed with no `ENTITY_MODELS`, `prototype`, `normalizeEntityRemoteResult`, or `toJSON()` usage.
- Static handler coverage scan confirmed explicit Repository handlers for `find`, `read`, `listIssues`, `getIssue`, `add`, `startMissionFromIssue`, and `startMissionFromBrief`.
- Protocol version scan confirmed `PROTOCOL_VERSION = 24` in `packages/core/src/daemon/protocol/contracts.ts`.
- `mission.json` parsed successfully after workflow-state updates.
- Editor diagnostics reported no errors for daemon dispatch, daemon dispatch tests, protocol contracts, this verification ledger, or `mission.json`.

### Task 03 Boundary Evidence

- Daemon entity dispatch now routes only through explicit Repository query and command switch handlers.
- Query handlers parse payloads before execution and parse results before returning.
- Command handlers parse payloads before execution and parse results before returning.
- Instance handlers resolve Repository instances explicitly and fail when an instance cannot be resolved.
- Unknown entities, unknown methods, invalid payloads, invalid results, and missing daemon context fail loudly.
- Focused tests exercise the protocol bump, static Repository handlers, instance Repository handlers, unknown entity/method failures, invalid payload failures, invalid result failures, missing instance failures, and missing context failures.

### Task 03 Remaining Gaps Outside Scope

- Airport client mirror cleanup and route-local Repository remote removal remain deferred to task 04.
- SSE projection ownership remains deferred to task 05.
- Package export tightening and removal of public deep transitional exports remain deferred to task 06.

## 2026-04-26 - Task 04 Verify Airport Repository Mirror

Task: `implementation/04-clean-airport-repository-mirror-verify`

### Task 04 Focused Evidence

- `pnpm --dir apps/airport/web test src/routes/api/entities/remote/dispatch.test.ts src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts` passed: 3 files / 7 tests.
- Static route-local Repository remote scan passed: no `issue.remote.ts` or `mission.remote.ts` remain under `apps/airport/web/src/routes` for Repository behavior.
- Static bypass scan passed: no active `getRepositoryIssues`, `getRepositoryIssue`, Repository `issue.remote`, or Repository `mission.remote` caller remains in Airport web source.
- Static browser-boundary scan passed for this slice: no browser-reachable match for deep `@flying-pillow/mission-core/entities/*Remote*` imports and no static `$lib/server/daemon/entity-proxy` import in remote modules.
- Static Repository mirror scan confirmed command/query payload ownership stays in `Repository.svelte.ts`, including `repositoryRootPath` in instance command/query payloads.
- Svelte autofixer reported no issues for `IssueList.svelte` after the Repository issue list type import was moved to the local entity type barrel.
- Editor diagnostics reported no errors for the changed Repository mirror, issue list component, generic query/command remotes, airport remote helper, mission transports, or `mission.json`.
- `mission.json` parsed successfully after workflow-state updates, and `mission.events.jsonl` parsed successfully after appending the task 04 session/task events.

### Task 04 Boundary Evidence

- `Repository.find`, `Repository.add`, `refresh`, `listIssues`, `getIssue`, `startMissionFromIssue`, and `startMissionFromBrief` are component-facing methods on the browser Repository mirror and call the generic query/command remotes.
- `IssueList.svelte`, `Issue.svelte`, and `BriefForm.svelte` consume scoped Repository mirror methods instead of composing Repository remote payloads or importing route-local Repository remotes.
- Generic query and command remote wrappers dynamically import `EntityProxy` inside server callbacks, preserving the browser-reachable remote module boundary.
- The unused generic `form.remote.ts` wrapper was removed because no caller used `frm` and SvelteKit remote forms cannot safely carry the generic `payload: unknown` invocation shape.
- Mission runtime transport files no longer import the deep Mission remote contract from the core entities tree; they keep local `Mission` entity names while using the generic remote invocation schemas.

### Task 04 Remaining Gaps Outside Scope

- `pnpm --dir apps/airport/web check` still exits 1 with pre-existing Airport web baseline errors in unrelated providers, runtime routes, route component props, and locals typings. The task-specific `form.remote.ts` diagnostic is gone after removing the unused wrapper.
- SSE projection ownership remains deferred to task 05.
- Package export tightening and broader removal of transitional package surfaces remain deferred to task 06.

## 2026-04-26 - Task 05 Verify SSE Projection Ownership

Task: `implementation/05-wire-sse-projection-ownership-verify`

### Task 05 Focused Evidence

- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/daemon/entityRemote.test.ts packages/core/src/entities/Repository/Repository.test.ts` passed: 2 files / 13 tests.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm --dir apps/airport/web test src/routes/api/entities/remote/dispatch.test.ts src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts` passed: 3 files / 7 tests.
- Static scan confirmed Repository mission-start result schemas now use `repositoryMissionStartAcknowledgementSchema` for `startMissionFromIssue` and `startMissionFromBrief`.
- Static scan confirmed obsolete `repositoryMissionMutationStatusSchema`, `RepositoryMissionMutationStatus`, and browser `result.missionId` result handling are absent.
- Static scan confirmed daemon SSE forwarding filters by mission and supported runtime event type before emitting parsed runtime envelopes through `toRuntimeEventEnvelope`.
- Svelte autofixer reported no issues for `Repository.svelte.ts` after the browser mirror switched to acknowledgement parsing.
- Editor diagnostics reported no errors for changed Repository schemas, Repository entity, daemon dispatch, daemon dispatch tests, browser Repository mirror, daemon gateway, or `mission.json`.

### Task 05 Boundary Evidence

- Repository mission-start commands now return a source acknowledgement shaped as `{ ok: true, entity: "Repository", method, id }` rather than a mutation status or broad cross-entity projection.
- Browser Repository mirror derives route navigation from acknowledgement `id` while continuing to expose component-facing `{ missionId, redirectTo }` convenience data.
- Daemon dispatch parses Repository mission-start results with the acknowledgement schema before returning.
- Daemon runtime event forwarding validates event envelopes with shared RuntimeEvents schemas and forwards only supported mission runtime projection events.
- The focused daemon test explicitly rejects projection-shaped mission-start command responses containing `status` and `sessions`.

### Task 05 Remaining Gaps Outside Scope

- Full Mission command migration to acknowledgement-plus-SSE remains limited to the existing Mission transport state noted in SPEC.md as a broader follow-up; this task only changes Repository mission-start source commands.
- Package export tightening and removal of public deep transitional exports remain deferred to task 06.

## 2026-04-26 - Task 06 Verify Exports And Removed Transitional Layers

Task: `implementation/06-tighten-exports-and-remove-transitional-layers-verify`

### Task 06 Focused Evidence

- `pnpm --filter @flying-pillow/mission-core check` passed after moving Airport-client schemas and stable type exports into `@flying-pillow/mission-core/schemas`.
- `pnpm --filter @flying-pillow/mission-core build` passed and refreshed the built `./schemas` entrypoint used by Airport web tests.
- `pnpm --dir apps/airport/web test src/routes/api/entities/remote/dispatch.test.ts src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts` passed: 3 files / 7 tests.
- Core package export inspection passed. The public export map is now exactly `.`, `./schemas`, `./browser`, `./node`, and `./daemon`.
- Static package export scan passed with no `./*`, `./airport`, `./airport/runtime`, or `./entities/Mission/MissionRemoteContract` export.
- Static Airport web import scan passed with no `@flying-pillow/mission-core/airport`, `@flying-pillow/mission-core/airport/runtime`, `@flying-pillow/mission-core/types.js`, deep `@flying-pillow/mission-core/entities`, or deep daemon protocol imports under `apps/airport/web/src`.
- Static Repository route-remote scan passed: no route-local Repository `issue.remote.ts` or `mission.remote.ts` remains under `apps/airport/web/src/routes/(app)/repository/[repositoryId]`.
- Static obsolete-symbol scan passed for browser/shared source: no `MissionRemoteContract`, `repositorySurfaceSnapshotSchema`, `repositoryMissionMutationStatusSchema`, `normalizeEntityRemoteResult`, or `ENTITY_MODELS` match remains in the checked Airport web target paths.
- `pnpm --dir apps/airport/web check` still exits 1 with unrelated baseline errors, but a focused filter over the latest log found no task-specific package export/import failures and no remaining `TerminalTransportBroker` diagnostics.
- Svelte autofixer reported no issues for the Svelte components where import-only changes were made and validated during this slice: `AgentSessionActionbar.svelte`, `ArtifactActionbar.svelte`, `TaskActionbar.svelte`, and `MissionView.svelte`.

### Task 06 Boundary Evidence

- `packages/core/package.json` now exposes only minimal stable entrypoints and no wildcard/deep/transitional package exports.
- `packages/core/src/schemas/AirportClient.ts` owns Airport-client schema-facing contracts such as GitHub visible repositories, Airport home snapshots, mission terminal snapshots, and terminal socket messages.
- `packages/core/src/schemas/index.ts` exports the Airport-client schema values and type aliases needed by Airport web through the canonical schema barrel.
- Airport web browser-facing files now consume schema-facing types through `@flying-pillow/mission-core/schemas` or the local entity type barrel instead of the removed deep/wildcard package paths.
- Server-only `DaemonGateway` now consumes `toMission` and daemon protocol types through the stable `@flying-pillow/mission-core/node` entrypoint instead of deep entity/protocol imports.
- The unused transitional `apps/airport/web/src/routes/api/airport/remote.ts` module was removed because it still depended on the forbidden `airport/runtime` package export and had no active callers.
- Runtime parsers for Repository summaries/snapshots, Mission runtime snapshots, runtime event envelopes, issues, and mission command payloads now delegate to shared canonical schemas instead of manual shape checks.
- Terminal transport generics were tightened after moving terminal contracts to canonical schemas so the changed imports do not introduce new diagnostics.

### Task 06 Remaining Gaps Outside Scope

- Full Airport web checking remains blocked by unrelated baseline errors already present outside this export/import cleanup slice. Latest summary: `svelte-check found 117 errors and 2 warnings in 26 files`.
- Broad Mission command migration to command acknowledgement plus SSE remains a future phase beyond this Repository-first package export cleanup.

## Unit Test Evidence

- `pnpm run test:web` now passes for the Airport web app and executes 7 files / 34 tests, including `src/routes/api/entities/remote/dispatch.test.ts`.
- Static review confirms the generic entity remote boundary now exists at `apps/airport/web/src/routes/api/entities/remote/query.remote.ts`, `command.remote.ts`, and `form.remote.ts`. Each file is a thin SvelteKit remote wrapper that validates the invocation schema, creates `AirportWebGateway`, and delegates to `executeEntityQuery`, `executeEntityCommand`, or `executeEntityForm`.
- `src/routes/api/entities/remote/dispatch.test.ts` provides focused proof of the new entity-method surface for this slice:
  - schema acceptance for reference-style query / command / form invocations;
  - schema rejection for route-local method drift (`getRepositoryIssues`);
  - query dispatch for `Airport.listRepositories`, `Repository.listIssues`, and `Repository.getIssue`;
  - command / form dispatch for `Repository.startMissionFromIssue` and `Repository.startMissionFromBrief`;
  - explicit failure when a mission mutation returns no `missionId`;
  - helper-level coverage that the transitional `airport.remote.ts`, `issue.remote.ts`, and `mission.remote.ts` entrypoints can delegate through the entity boundary helpers instead of calling gateway operations directly.
- Static review of the transitional remotes shows the slice moved them onto the generic boundary:
  - `src/routes/airport.remote.ts` delegates to `listAirportRepositoriesThroughEntityBoundary(...)`;
  - `src/routes/repository/[repositoryId]/issue.remote.ts` delegates to `listRepositoryIssuesThroughEntityBoundary(...)` and `getRepositoryIssueThroughEntityBoundary(...)`;
  - `src/routes/repository/[repositoryId]/mission.remote.ts` delegates to `startMissionFromIssueThroughEntityBoundary(...)` and `startMissionFromBriefThroughEntityBoundary(...)`.
- Static review of `src/lib/server/gateway/AirportWebGateway.server.ts` shows the gateway remains the server-side translation layer from remote calls into daemon/core APIs. For this slice it is no longer bypassed by route-specific entity actions, but it still exposes operation-specific methods and still owns daemon connection setup, repository lookup, and mission-control helpers outside the generic dispatcher itself.
- `pnpm run test:packages` still provides no package-level evidence for this slice. The run reports `No test files found` for both `@flying-pillow/mission-core` and `@flying-pillow/mission`, so no core-level entity or daemon integration coverage is exercised by the repository script.
- `pnpm run check:web` is still blocked by unrelated baseline TypeScript errors in `@flying-pillow/mission-core`, including duplicate exports in `src/browser.ts` / `src/index.ts`, missing `artifactNode` references in `src/daemon/Daemon.test.ts`, and `exactOptionalPropertyTypes` incompatibilities in `src/workflow/engine/reducer.ts`.

## 2026-04-26 - Task 07 Implement GitHub Repository Source Entity

Task: `implementation/07-implement-github-repository-source-entity`

### Task 07 Focused Evidence

- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/daemon/entityRemote.test.ts` passed: 1 file / 10 tests.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm --dir apps/airport/web test src/routes/api/entities/remote/dispatch.test.ts src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts` passed: 3 files / 7 tests.
- Editor diagnostics reported no errors for the changed GitHubRepository source entity, daemon dispatch, Airport application loader, or GitHubRepository schema files.
- Inline browser reload of `/airport` no longer showed the minimal-daemon `control.github.repositories.list` error in the GitHub repository browser. After fixing the imperative client query call to use `.run()`, the browser rendered 29 GitHub repositories, including `Flying-Pillow/mission`, with `Use repository` actions.

### Task 07 Boundary Evidence

- `packages/core/src/schemas/GitHubRepository.ts` now owns canonical `GitHubRepository` payload/result schemas and is exported from `@flying-pillow/mission-core/schemas`.
- Backend `GitHubRepository` now delegates provider operations through `createRepositoryPlatformAdapter({ platform: "github", ... })` instead of constructing `GitHubPlatformAdapter` directly.
- Daemon entity dispatch now explicitly handles `GitHubRepository.find` and `GitHubRepository.clone` alongside Repository handlers.
- Airport `Application.loadGitHubRepositories()` now calls the `GithubRepository` client mirror through the generic entity query path instead of the airport-specific `readVisibleGitHubRepositories` command.
- `GithubRepository.find()` uses `.run()` because `Application.loadGitHubRepositories()` calls it imperatively outside a render-time reactive query context.

### Task 07 Remaining Gaps Outside Scope

- The old airport remote command still exists as transitional server code, but it is no longer used by the active Airport GitHub repository browser path.
- Full authenticated GitHub repository listing was validated in the inline browser for the current running Airport session.

## 2026-04-26 - Task 08 Implement Canonical Mission Schema Contracts

Task: `implementation/08-create-canonical-mission-schema-contracts`

### Task 08 Focused Evidence

- `packages/core/src/schemas/Mission.ts` now owns canonical Mission identity, snapshot, child projection, action, document, worktree, command payload, query payload, query result, command result, and acknowledgement schemas.
- `packages/core/src/schemas/index.ts` exports the new Mission schema module through `@flying-pillow/mission-core/schemas`.
- `packages/core/src/entities/Mission/MissionRemoteContract.ts` was removed instead of retained as a compatibility wrapper.
- `packages/core/src/entities/Mission/MissionRemote.ts` imports Mission payload types from the canonical schema module, so active source no longer imports payload contracts from the deep MissionRemoteContract file.
- A focused static ownership script passed, confirming required Mission schema exports, the schema barrel export, absence of active `MissionRemote` deep-contract imports, no public deep package export, and no `.passthrough()` use in the Mission schema module.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm --filter @flying-pillow/mission-core build` passed.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 7 tests.
- `git diff --check -- packages/core/src/schemas/Mission.ts packages/core/src/schemas/index.ts packages/core/src/entities/Mission/MissionRemote.ts` passed.

### Task 08 Boundary Evidence

- Mission command acknowledgement schemas are source-local and do not accept broad runtime projection fields such as workflow/session/task snapshots.
- Mission document and worktree response schemas are strict and mirror the existing Airport source-local shapes without moving route behavior in this slice.
- Mission query and command schema maps include the target Mission methods from SPEC.md while leaving daemon dispatch, Airport mirror rewiring, and runtime route removal to later tasks.

### Task 08 Remaining Gaps Outside Scope

- Existing Mission runtime behavior still returns broad runtime snapshots for current commands until the daemon-authoritative Mission and explicit dispatch tasks migrate behavior to acknowledgements plus projection updates.
- Airport document/worktree runtime routes and local file-tree types remain transitional until the later Mission mirror and route cleanup tasks.

## 2026-04-26 - Task 08 Verify Canonical Mission Schema Contracts

Task: `implementation/08-create-canonical-mission-schema-contracts-verify`

### Task 08 Verify Focused Evidence

- Executable Zod strictness assertions passed for Mission identity payloads, Stage/Task/Artifact/AgentSession child projection schemas, Mission query result ownership, and Mission command acknowledgement result ownership.
- The strictness assertions confirmed `missionRemoteQueryResultSchemas.read` is `missionSnapshotSchema`, `missionRemoteCommandResultSchemas.command` is `missionCommandAcknowledgementSchema`, valid Mission command acknowledgements parse, and acknowledgement parsing rejects broad projection fields such as `status`, `sessions`, and `workflow`.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm --filter @flying-pillow/mission-core build` passed.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 7 tests.
- Static ownership scan passed: `packages/core/src/schemas/Mission.ts` exports Mission identity, snapshot, child projection, method payload, method result, and acknowledgement schemas; the public schema barrel exports `./Mission.js`; `MissionRemoteContract.ts` is absent; `MissionRemote.ts` does not import the deep contract; Mission command result schemas do not accept `MissionRuntimeSnapshot`; and Mission schema code contains no `.passthrough()`.
- Browser/client Mission contract scan passed for the focused target files: no `MissionRemoteContract` usage and no `@flying-pillow/mission-core/node`, daemon, airport/runtime, or deep entity contract import in Mission client/component contract paths.
- `git diff --check -- packages/core/src/schemas/Mission.ts packages/core/src/schemas/index.ts packages/core/src/entities/Mission/MissionRemote.ts .mission/missions/29-architectural-reset-strict-ood-entity-architectu/03-IMPLEMENTATION/VERIFY.md .mission/missions/29-architectural-reset-strict-ood-entity-architectu/mission.json .mission/missions/29-architectural-reset-strict-ood-entity-architectu/mission.events.jsonl` passed.

### Task 08 Verify Boundary Evidence

- Deep `MissionRemoteContract` is no longer present; canonical Mission schemas are imported directly from `@flying-pillow/mission-core/schemas` or the source schema module.
- Airport server-only `@flying-pillow/mission-core/node` imports still exist for daemon/filesystem infrastructure, but browser/client Mission contract files import schemas from `@flying-pillow/mission-core/schemas`.
- Behavior migration remains intentionally deferred: `MissionRemote`, daemon explicit Mission dispatch, Airport mirror cleanup, and route removal are later tasks.

### Task 08 Verify Remaining Gaps Outside Scope

- Full `pnpm --dir apps/airport/web run check` remains blocked by existing app-wide baseline issues, so this verification used focused web transport tests and browser/client import scans for the task-specific surface.
- Runtime command responses will be migrated from broad snapshots to acknowledgements in tasks 09-12; this verification only proves the canonical schema contract target exists and rejects broad command-result projection shapes.

## 2026-04-26 - Task 09 Implement Mission Daemon Authority

Task: `implementation/09-make-mission-daemon-authoritative`

### Task 09 Focused Evidence

- `packages/core/src/entities/Mission/MissionCommands.ts` now owns the focused Mission daemon-source collaborator for runtime loading, canonical payload parsing, explicit mission resolution, runtime disposal, source method execution, and result parsing.
- `packages/core/src/entities/Mission/MissionRemote.ts` is reduced to a compatibility delegate that forwards existing static calls to `MissionCommands` instead of owning runtime loading or Mission runtime snapshot result construction.
- `packages/core/src/entities/Mission/MissionCommands.test.ts` passed: 1 file / 6 tests covering invalid payload rejection before runtime loading, missing mission failure, snapshot read parsing, disposal on result parse failure, command acknowledgement shape, and task terminal loader forwarding.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm --filter @flying-pillow/mission-core build` passed.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 7 tests.
- Static Mission source authority scan passed: source methods parse canonical Mission payload schemas, `read` parses `missionSnapshotSchema`, commands parse `missionCommandAcknowledgementSchema`, runtimes are disposed, missing missions fail explicitly, `MissionCommands` does not return `MissionRuntimeSnapshot`, and `MissionRemote` is a thin delegate without `Factory.load` or `missionRuntimeSnapshotSchema` ownership.

### Task 09 Boundary Evidence

- `MissionCommands.read` returns a strict canonical `MissionSnapshot` derived from `MissionRuntime.toEntity()` and parsed through the canonical Mission schema surface.
- Mission command methods now return source acknowledgements instead of broad runtime projection snapshots; broad workflow/session/status projections remain the responsibility of SSE projection events in later tasks.
- Runtime loading remains repository-scoped through `surfacePath` / optional `repositoryRootPath`, uses existing workflow/settings/runner setup, and fails loudly if the Mission cannot be resolved.
- Runtime disposal is guaranteed with `finally` blocks for read and command execution paths, including result parsing failures.

### Task 09 Remaining Gaps Outside Scope

- Daemon generic entity dispatch does not yet route Mission methods to `MissionCommands`; explicit Mission dispatch is task 10.
- Airport Mission mirror behavior and runtime route cleanup remain deferred to tasks 11 and 12.

## 2026-04-26 - Task 09 Verify Mission Daemon Authority

Task: `implementation/09-make-mission-daemon-authoritative-verify`

### Task 09 Verify Focused Evidence

- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/entities/Mission/MissionCommands.test.ts` passed: 1 file / 9 tests.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm --filter @flying-pillow/mission-core build` passed.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 7 tests.
- Static MissionCommands verification scan passed: every implemented Mission source method parses canonical Mission payload schemas, `read` parses `missionSnapshotSchema`, commands parse `missionCommandAcknowledgementSchema`, missing mission and missing surface context failures are explicit, runtimes are disposed, `MissionCommands` does not reference `MissionRuntimeSnapshot` or `operatorStatusSchema`, and `MissionRemote` delegates to `MissionCommands` without owning runtime loading or broad runtime result shaping.
- Editor diagnostics reported no errors for `MissionCommands.ts`, `MissionRemote.ts`, `MissionCommands.test.ts`, `schemas/Mission.ts`, this verification ledger, `mission.json`, or `mission.events.jsonl`.

### Task 09 Verify Boundary Evidence

- Focused tests now cover invalid payload rejection before runtime loading, unresolved mission failure, missing `surfacePath` failure before loader use, strict Mission snapshot parsing, disposal on parse failure, Mission command acknowledgement shape, task terminal loader forwarding, session prompt normalization with acknowledgement results, and workflow action execution with acknowledgement results.
- `MissionRemote` is no longer the only daemon-callable behavior owner; it is a thin compatibility shim over `MissionCommands`.
- Command verification rejects broad projection semantics by checking acknowledgement results do not include `workflow`, `sessions`, or `status` fields.

### Task 09 Verify Remaining Gaps Outside Scope

- Explicit daemon dispatch for Mission methods remains deferred to task 10.
- Airport Mission mirror migration remains deferred to task 11.
- Mission projection wiring and request-response runtime route cleanup remain deferred to task 12.

## 2026-04-26 - Task 10 Implement Mission Explicit Dispatch

Task: `implementation/10-route-mission-through-explicit-dispatch`

### Task 10 Focused Evidence

- `packages/core/src/daemon/entityRemote.ts` now routes `Mission` through explicit query and command switch handlers, with method-specific payload parsing and result parsing for `read`, `readControl`, `listActions`, `readDocument`, `readWorktree`, `command`, `taskCommand`, `sessionCommand`, `executeAction`, and `writeDocument`.
- `packages/core/src/entities/Mission/MissionCommands.ts` now provides source-local implementations for Mission control/action/document/worktree request-response methods, including scoped document path validation and worktree tree reads.
- `packages/core/src/daemon/protocol/contracts.ts` bumped `PROTOCOL_VERSION` from `24` to `25` for the changed generic entity RPC behavior.
- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/daemon/entityRemote.test.ts packages/core/src/entities/Mission/MissionCommands.test.ts` passed: 2 files / 21 tests.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm --filter @flying-pillow/mission-core build` passed.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 7 tests.
- Static dispatch scan confirmed all Mission method cases are explicit in `entityRemote.ts`; no dynamic `MissionCommands[...]`, method-index, prototype, or `Object.keys(MissionCommands)` lookup pattern was present.
- `git diff --check` passed.
- Editor diagnostics reported no errors for daemon dispatch, Mission source/delegate files, and their focused tests.

### Task 10 Boundary Evidence

- Daemon Mission query handlers parse canonical payloads before calling `MissionCommands` and parse source results before returning.
- Daemon Mission command handlers return source acknowledgements for source commands and source-local document snapshots for `writeDocument`; broad Mission runtime projections remain outside command responses.
- Unknown Mission methods fail loudly with daemon method errors, and invalid Mission payloads/results reject with `ZodError` before returning to callers.
- Mission document reads/writes are constrained to the active repository root or Mission worktree root, preserving repository-scoped source ownership.

### Task 10 Remaining Gaps Outside Scope

- Airport Mission mirror migration remains deferred to task 11.
- Mission projection wiring and request-response runtime route cleanup remain deferred to task 12.

## 2026-04-26 - Task 10 Verify Mission Explicit Dispatch

Task: `implementation/10-route-mission-through-explicit-dispatch-verify`

### Task 10 Verify Focused Evidence

- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/daemon/entityRemote.test.ts packages/core/src/entities/Mission/MissionCommands.test.ts` passed: 2 files / 21 tests.
- `pnpm --filter @flying-pillow/mission-core check` passed.
- `pnpm --filter @flying-pillow/mission-core build` passed.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 7 tests.
- Static dispatch scan passed with no `MissionCommands[...]`, `Object.keys(MissionCommands)`, prototype dispatch, or `MissionRemoteContract` match in the checked daemon/Mission source files.
- `git diff --check` passed.

### Task 10 Verify Boundary Evidence

- Daemon generic entity dispatch now has explicit Mission query and command handlers for every task 10 method.
- Mission payload parsing and result parsing remain method-specific in daemon dispatch instead of delegated to dynamic method lookup or a generic result normalizer.
- Unknown Mission command methods fail loudly, and invalid Mission payload/result shapes are covered by focused daemon tests with `ZodError` expectations.
- `PROTOCOL_VERSION` is validated at `25` by the focused daemon dispatch suite.
- The `MissionRemoteContract` wrapper file is removed; canonical Mission payload/result schemas are imported directly from `packages/core/src/schemas/Mission.ts`.

### Task 10 Verify Remaining Gaps Outside Scope

- Airport Mission mirror migration remains deferred to task 11.
- Mission projection wiring and request-response runtime route cleanup remain deferred to task 12.

## 2026-04-26 - Task 11 Implement Airport Mission Mirror

Task: `implementation/11-clean-airport-mission-mirror`

### Task 11 Focused Evidence

- `MissionCommandTransport` now uses generic Mission entity query/command remotes and parses canonical Mission projection, actions, document, worktree, command, task, and session schemas directly from `@flying-pillow/mission-core/schemas`.
- The canonical Mission request-response projection vocabulary is now `MissionProjectionSnapshot`, `missionProjectionSnapshotSchema`, `MissionReadProjectionPayload`, `missionReadProjectionPayloadSchema`, and daemon query method `readProjection`; the prohibited `MissionControlSnapshot as MissionProjectionSnapshot` alias was removed instead of preserved.
- `MissionRuntimeTransport` now reads `Mission.read` through the generic query remote and returns canonical `MissionSnapshot` values.
- The Airport `Mission` mirror and child `Task`, `Stage`, `Artifact`, and `AgentSession` mirrors consume canonical Mission snapshot/projection types and route commands through the owning Mission command gateway.
- `ScopedActionbar` now consumes canonical `MissionActionListSnapshot` / `MissionActionDescriptor` directly, without an adapter into the old operator action shape.
- The Mission route and Mission surface no longer consume `operatorStatus` or `applyOperatorStatus`; Mission status updates are applied through canonical `MissionStatusSnapshot` projection data.
- Removed the unused old `MissionView.svelte`, `MissionControlTree.svelte`, and `missionControl.ts` surfaces; the active Mission route now uses projection state directly on the Mission mirror.
- Static scan over active Mission core, daemon dispatch, browser transport, Mission mirror, actionbar, and route paths found no `MissionEntityAdapters`, `MissionRemoteContract`, `MissionRuntimeSnapshot`, `getMissionRuntimeSnapshot`, command-returned runtime snapshot parsing, `operatorStatus`, `applyOperatorStatus`, `MissionControlSnapshot as MissionProjectionSnapshot`, `missionControlSnapshotSchema`, `missionReadControlPayloadSchema`, or `readControl` matches.
- Editor diagnostics reported no errors for the touched Mission schema, daemon commands, daemon dispatch, Mission transport, runtime, mirror, route, actionbar, child mirror, and focused test files.
- Svelte autofixer reported no issues for `Mission.svelte.ts`, `Mission.svelte`, `ScopedActionbar.svelte`, and the route wrapper; it only repeated existing `$effect` state-mutation suggestions for interactive components.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 9 tests.
- `pnpm exec vp test run --config vitest.config.ts --project core packages/core/src/daemon/entityRemote.test.ts` passed: 1 file / 12 tests.

### Task 11 Remaining Gaps Outside Scope

- `git diff --check` still reports an unrelated existing whitespace issue in `apps/airport/web/src/routes/+page.svelte` that was not touched in this task.
- Full Mission projection tree reconstruction and removal of old request-response runtime routes are deferred to task 12.

## 2026-04-26 - Task 11 Verify Airport Mission Mirror

Task: `implementation/11-clean-airport-mission-mirror-verify`

### Task 11 Verify Focused Evidence

- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 9 tests.
- `pnpm exec vp test run --config vitest.config.ts --project core packages/core/src/daemon/entityRemote.test.ts` passed: 1 file / 12 tests.
- Static transport scan passed for `MissionCommandTransport.ts` and `MissionRuntimeTransport.ts`: no `MissionRuntimeSnapshot`, `getMissionRuntimeSnapshot`, `parseMissionRuntimeSnapshot`, `getMissionControl`, `missionControlSnapshotSchema`, `operatorStatusSchema`, or direct `fetch(...)` usage remains in those transports.
- Refined browser/client scans passed: no active `mission-control` type imports, `MissionControlSnapshot`, `missionControlSnapshotSchema`, `getMissionControl`, `applyOperatorStatus`, or `operatorStatus` usage remains in active client/component Mission paths after excluding comments and the Task 12 transitional server route.
- Non-streaming runtime URL scan passed for active browser/client paths: no `/api/runtime/missions/*` request-response route usage remains for Mission control, actions, documents, worktree, or snapshot loading. Terminal streaming URLs remain intentionally in `TerminalTransportBroker.ts`.
- Client-side core import boundary scan passed: active browser/component paths do not import `@flying-pillow/mission-core/node`, daemon, deep `entities`, `airport`, `airport/runtime`, or `MissionRemoteContract` surfaces.
- Child mirror scan confirmed Task, AgentSession, and Artifact mirrors expose domain-shaped methods and do not import generic remotes, runtime transports, or route-local Mission request-response URLs directly.
- Canonical schema usage scan confirmed Mission transports, Mission mirror, child mirrors, and `ScopedActionbar` import Mission contracts from `@flying-pillow/mission-core/schemas`.
- Editor diagnostics reported no errors for the focused Mission transport, Mission mirror, Mission route wrapper, actionbar, Task, AgentSession, and Artifact files.
- Targeted `git diff --check` passed for the focused Task 11 Mission mirror files and supporting Mission core/daemon files.

### Task 11 Verify Boundary Evidence

- Airport Mission command methods now return acknowledgements or source-local document results and refresh/query for reconciliation instead of applying command-returned `MissionRuntimeSnapshot` values.
- Mission read/projection/action/document/worktree request-response behavior is reached through the `Mission` mirror and generic entity query/command remotes.
- Task and AgentSession command methods remain child-shaped browser APIs, but their actual backend-backed behavior routes through the owning Mission mirror command gateway.
- The route wrapper at `apps/airport/web/src/routes/(app)/repository/[repositoryId]/missions/[missionId]/Mission.svelte` delegates to the Mission entity surface instead of reconstructing Mission page state locally.

### Task 11 Verify Remaining Gaps Outside Scope

- `apps/airport/web/src/routes/(app)/repository/[repositoryId]/missions/[missionId]/mission-page.remote.ts` and request-response runtime server routes still exist as transitional server-side leftovers. Task 12 owns removing or reducing those routes.
- Terminal stream URLs remain in `TerminalTransportBroker.ts` because terminal/socket transport is explicitly retained as streaming infrastructure, not Mission request-response behavior.

## 2026-04-26 - Task 12 Implement Mission Projections And Runtime Route Cleanup

Task: `implementation/12-wire-mission-projections-and-remove-runtime-routes`

### Task 12 Focused Evidence

- `packages/core/src/schemas/RuntimeEvents.ts` now validates Airport runtime envelopes with typed payload schemas for `mission.status`, `mission.actions.changed`, `session.event`, and `session.lifecycle` instead of leaving entity projection payloads as `unknown`.
- `apps/airport/web/src/lib/server/daemon/daemon-gateway.ts` now projects daemon notifications into typed Airport payloads before SSE serialization and subscribes to `session.event` alongside Mission status/action/lifecycle notifications.
- `apps/airport/web/src/lib/components/entities/Mission/Mission.svelte.ts` now reconciles Mission projection snapshots, Mission status updates, Stage/Task/Artifact child projections, and individual AgentSession snapshots without relying on command-returned broad runtime snapshots.
- `apps/airport/web/src/lib/components/entities/Mission/Mission.svelte` now applies typed Mission status and AgentSession event payloads from SSE, refreshes projection state after action/lifecycle changes, and keeps command mutation reconciliation on query/SSE refresh.
- Removed duplicate request-response Mission runtime routes for snapshot, actions, control, documents, session commands, task commands, and worktree reads under `apps/airport/web/src/routes/api/runtime/missions/[missionId]/`; the retained runtime route is terminal transport only.
- Removed stale route-local Mission page bundle authority by deleting `apps/airport/web/src/routes/(app)/repository/[repositoryId]/missions/[missionId]/mission-page.remote.ts` and `apps/airport/web/src/lib/components/entities/Mission/MissionProvider.svelte`.
- Removed obsolete Mission snapshot bundle code from `apps/airport/web/src/routes/api/airport/airport.remote.ts`, stale commented bundle wiring from `Application.svelte.ts`, and `parseMissionRuntimeSnapshot` from `apps/airport/web/src/lib/client/runtime/parsers.ts`.
- Added `packages/core/src/schemas/RuntimeEvents.test.ts` covering typed Mission status, typed AgentSession event payloads, typed lifecycle-only notifications, and malformed projection payload rejection.

### Task 12 Verification Evidence

- Editor diagnostics reported no errors for `RuntimeEvents.ts`, `RuntimeEvents.test.ts`, `daemon-gateway.ts`, `Mission.svelte.ts`, `Mission.svelte`, `airport.remote.ts`, `Application.svelte.ts`, and `parsers.ts`.
- Svelte autofixer reported no issues after the Mission Svelte event-handling edits.
- Static route cleanup scan passed: no `readMissionRuntime`, `readMissionControl`, `readMissionSnapshotBundle`, `getMissionSnapshotBundle`, `mission-page.remote`, `parseMissionRuntimeSnapshot`, or Airport-side `missionRuntimeSnapshotSchema` references remain.
- Runtime URL scan passed for request-response cleanup: the only remaining `/api/runtime/missions` references are terminal transport URLs in `TerminalTransportBroker.ts`.
- `pnpm --filter @flying-pillow/mission-core build` passed after refreshing the core build output needed by the web test runner.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 9 tests.
- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/schemas/RuntimeEvents.test.ts packages/core/src/daemon/entityRemote.test.ts packages/core/src/entities/Mission/MissionCommands.test.ts` passed: 3 files / 25 tests.
- Targeted `git diff --check` passed for the Task 12 changed and deleted Mission projection, gateway, route, parser, and bundle files.

### Task 12 Boundary Evidence

- Mission command responses remain acknowledgements or source-local document results; no command response now carries `status`, `sessions`, `workflow`, or other broad projection fields for reconciliation.
- Mission projection and AgentSession event payloads are parsed against shared schemas before the browser mirror mutates client state.
- Duplicate request-response runtime APIs no longer own Mission snapshot, control/action, document, worktree, task, or session command behavior; those behaviors remain behind generic Mission entity remotes.
- Terminal runtime URLs remain intentionally because terminal/session screen and input flows are streaming/transport infrastructure, not Mission entity command responses.

### Task 12 Remaining Gaps Outside Scope

- `TerminalTransportBroker.ts` still references a `/terminal/ws` URL in addition to the retained terminal route. That is terminal transport-specific and was not removed in this cleanup slice.
- Stage, Task, Artifact, and AgentSession remain Mission child projections; promotion to independent daemon-callable source entities is a future task.

## 2026-04-26 - Task 12 Verify Mission Projections And Runtime Route Cleanup

Task: `implementation/12-wire-mission-projections-and-remove-runtime-routes-verify`

### Task 12 Verify Focused Evidence

- Editor diagnostics reported no errors for the final verification cleanup files: `RuntimeEvents.ts`, `AirportClient.ts`, `Repository.ts`, `daemon-gateway.ts`, `Mission.svelte.ts`, `Mission.svelte`, `Application.svelte.ts`, `Repository.svelte.ts`, the local entity type barrel, and the web library barrel.
- Static Mission runtime/control cleanup scan passed for active Airport web source: no `MissionRuntimeSnapshot`, `parseMissionRuntimeSnapshot`, `missionRuntimeSnapshotSchema`, `MissionControlSnapshot`, `missionControlSnapshotSchema`, `getMissionControl`, `applyOperatorStatus`, or `operatorStatusSchema` references remain under `apps/airport/web/src`.
- Static request-response route cleanup scan passed: no `readMissionRuntime`, `readMissionControl`, `readMissionSnapshotBundle`, `getMissionSnapshotBundle`, or `mission-page.remote` references remain, and the only remaining `/api/runtime/missions` URLs are terminal transport URLs in `TerminalTransportBroker.ts`.
- Core schema scan confirmed `missionRuntimeSnapshotSchema` remains only inside the legacy `MissionRuntime.ts` module itself; Airport active Mission code and `RepositorySnapshot.selectedMission` now use the canonical `MissionSnapshot` contract.
- The unused legacy `apps/airport/web/src/lib/types/mission-control.ts` file was removed during verification after scans showed no active imports.
- `pnpm --filter @flying-pillow/mission-core build` passed.
- `pnpm --dir apps/airport/web test src/lib/client/runtime/transport/MissionCommandTransport.test.ts src/lib/client/runtime/transport/MissionRuntimeTransport.test.ts src/routes/api/entities/remote/dispatch.test.ts` passed: 3 files / 9 tests.
- `pnpm exec vitest run --config vitest.config.ts --project core packages/core/src/schemas/RuntimeEvents.test.ts packages/core/src/daemon/entityRemote.test.ts packages/core/src/entities/Mission/MissionCommands.test.ts` passed: 3 files / 25 tests.
- Targeted `git diff --check` passed for the Task 12 verification files and mission ledger files.

### Task 12 Verify Boundary Evidence

- Mission command responses are acknowledgements or source-local document results; broad Mission/Stage/Task/Artifact/AgentSession reconciliation is driven by typed SSE payloads or explicit query refreshes.
- Mission status and AgentSession projection events are validated with shared RuntimeEvents schemas before mutating the client mirror.
- Client mirrors reconcile Mission, Stage, Task, Artifact, and AgentSession child state through `applyProjectionSnapshot`, `applyMissionStatus`, and AgentSession snapshot updates rather than command-returned runtime snapshots.
- Duplicate request-response runtime routes are removed or reduced; terminal snapshot/input and websocket URLs remain only as terminal streaming transport.

### Task 12 Verify Remaining Gaps Outside Scope

- `packages/core/src/schemas/MissionRuntime.ts` still defines the legacy Mission runtime schema types for remaining internal runtime compatibility, but active Airport Mission paths no longer import the broad runtime snapshot contract.
- Stage, Task, Artifact, and AgentSession remain Mission child projections instead of independent daemon-callable source entities; that promotion is outside this Mission migration verification.

## Gaps

- This verification task is **only partially satisfied**. The generic entity remote boundary is present and the dispatcher-level tests cover entity-method dispatch plus request validation, but the evidence does not yet cover every layer named in the task.
- There is still **no focused gateway test** for `apps/airport/web/src/lib/server/gateway/AirportWebGateway.server.ts`. Current proof comes from mocked dispatch tests and static review, not from tests that exercise the gateway as a thin translator around the new boundary.
- There is still **no direct test of the actual SvelteKit remote wrappers** in `query.remote.ts`, `command.remote.ts`, or `form.remote.ts`; current coverage stops at the shared dispatch helpers they invoke.
- There is still **no direct integration test of the transitional remotes** `airport.remote.ts`, `issue.remote.ts`, and `mission.remote.ts`. Static review shows they delegate through entity-boundary helpers, but `mission.remote.ts` still owns route-param resolution plus redirect / invalid response shaping locally, so transport-only behavior is not yet proven by executed tests.
- Package-level verification remains weak because `pnpm run test:packages` does not discover the intended core suites.
- A clean app-wide verification pass remains blocked by the unrelated `pnpm run check:web` failure in `@flying-pillow/mission-core`.
