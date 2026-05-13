# Open Mission System

Open Mission is a local-first engineering control system for coordinating repository-scoped missions, daemon-owned runtime state, Open Mission surfaces, and agent adapters.

## Language

### System

**Mission**:
A long-lived unit of engineering work with a brief, workflow state, artifacts, tasks, and agent executions.
_Avoid_: project, job, run, workflow

**Open Mission system**:
The local-first engineering control system that coordinates repositories, missions, daemon-owned runtime state, Open Mission surfaces, and agent adapters.
_Avoid_: Mission, app, platform

**Control plane**:
The daemon-owned live coordination layer that composes repository state, Mission state, Open Mission state, and client connections into live operator-facing views and routing state.
Use only as a runtime-plane umbrella term, not as the default name for module folders, types, or adapters when a narrower owner such as daemon projection, Open Mission substrate, Entity contract, or daemon client is known.
_Avoid_: generic folder prefix, catch-all type prefix, surface-owned state

**Open Mission app**:
The shared operator application model consumed by Open Mission hosts. It owns UI routes, component composition, application state shape, and query/command/subscription semantics through an abstract application client, not through host-specific APIs.
_Avoid_: web app only, native fork, host compatibility layer, daemon authority

**Open Mission host**:
A concrete runtime host for the Open Mission app, such as web or native. A host owns delivery and host capabilities only; it does not redefine Mission, workflow, repository, or Agent execution semantics.
_Avoid_: separate product, domain owner, command authority

**Open Mission app model layer**:
The application-facing model and view-contract layer over daemon truth and repository state. It is not renderer-specific code, a host-specific package, or a browser state store.
_Avoid_: projection layer, Svelte package, Tauri plugin, host compatibility layer, canonical daemon state

### Repository Plane

**Platform repository ref**:
The hosted repository identifier used by a repository platform adapter, for example the GitHub ref `Flying-Pillow/open-mission`.
_Avoid_: Repository, repository root

**GitHub repository ref**:
The GitHub-shaped Platform repository ref, for example `Flying-Pillow/open-mission`.
_Avoid_: Repository, repository root

**Repository**:
The local checked-out Git repository, preferably on the main branch, that the Open Mission system uses as the base for Mission worktrees.
_Avoid_: GitHub repository, mission worktree, workspace

**Repository root**:
The filesystem root path of a Repository.
_Avoid_: workspace root, mission worktree root

**Repository control state**:
Durable repository-scoped Open Mission system state stored under `.mission/`.
_Avoid_: workspace state, editor state, surface state

**Repository settings document**:
The `.mission/settings.json` file that stores operator-editable Repository control state values such as Mission worktree root, instruction paths, skills paths, and default Agent adapter preferences.
_Avoid_: config blob, workspace settings, surface preferences

**Repository workflow settings**:
The repository-level workflow defaults stored under the `workflow` section of `.mission/settings.json` and snapshotted into Mission runtime data when a draft Mission becomes ready.
_Avoid_: Mission workflow snapshot, surface settings, daemon-local preference, adapter metadata

**Control mode**:
The operator mode where Repository initialization and Repository policy operations such as workflow settings edits are available through daemon-owned commands.
_Avoid_: mission task mode, surface-only settings screen, direct file-edit mode

**Mission branch ref**:
The Git branch ref assigned to a Mission, for example `mission/29-architectural-reset-strict-ood-entity-architectu`.
_Avoid_: mission branch, mission worktree, checkout

**Remote mission branch ref**:
The remote Git branch ref corresponding to a Mission branch ref, for example `origin/mission/29-architectural-reset-strict-ood-entity-architectu`.
_Avoid_: remote mission branch, mission worktree

**Mission worktree**:
The local checked-out Git worktree materialized for a Mission.
_Avoid_: repository, workspace, mission branch, branch ref

**Mission worktree root**:
The filesystem root path of a Mission worktree.
_Avoid_: mission branch, repository root, workspace root

**GitHub adapter**:
An adapter for hosted GitHub operations against a GitHub repository ref.
_Avoid_: repository adapter, git adapter

**Git adapter**:
An adapter for local Git operations against a Repository root or Mission worktree root.
_Avoid_: GitHub adapter, repository adapter

### Mission Execution

**Mission dossier**:
The tracked mission history and control record for one Mission, stored under `.mission/missions/<mission-id>/` on a Mission branch ref. It includes Mission runtime data, the Mission runtime event log, Mission artifacts, task definitions, and other tracked Mission control records.
_Avoid_: mission folder, mission data, mission state folder

**Mission runtime data**:
The persisted daemon-owned MissionRuntime data shape for one Mission, including Mission task state, Agent execution state, configuration snapshot, and Derived workflow state. Mission runtime data is clean-slate validated: invalid runtime data is rejected rather than repaired through fallback parsing or load-time normalization.
_Avoid_: record, Mission state, Mission runtime module, agent execution schema, artifact schema, UI state file

**Mission dossier state store**:
A per-Open Mission daemon runtime module that accepts validated Mission runtime data changes, keeps live in-memory state for one Mission, and checkpoints Mission runtime data and the Mission runtime event log into the Mission dossier. It is not the daemon-wide Mission state store.
_Avoid_: Mission state store, MissionState, MissionRuntimeDossier, JSON live store

**Mission runtime schema version**:
The schema version of Mission runtime data; it versions the persisted workflow runtime data as a whole, not each Agent execution context or Mission artifact separately.
_Avoid_: agent execution context version, artifact version, surface protocol version

**Mission runtime migration**:
A deliberate, separately decided replacement of one Mission runtime data layout with another. It is not an implicit fallback parser, load-time normalizer, or hidden compatibility shim.
_Avoid_: surface migration, per-field fallback, ad hoc compatibility shim

**Running Mission instance**:
The daemon-owned in-memory authoritative Mission Entity for one Mission. It owns Mission lifecycle behavior, child-entity coordination, workflow-definition application, and hydration of the complete Mission Entity instance while the Mission is live, and it can run without any Open Mission surface connected.
_Avoid_: UI session mission, workflow controller, mission projection, surface-owned mission state

**Mission workflow definition**:
The repository-owned validated workflow law that a Running Mission instance applies for stage order, task generation, gate rules, artifact expectations, and execution constraints. Different repositories may use different Mission workflow definitions without introducing different Mission classes or alternate Mission instance models.
_Avoid_: workflow implementation, mission subclass, fallback settings blob, surface workflow

**Mission assignee**:
The optional Mission metadata naming the GitHub account currently responsible for first-response operator attention on that Mission. It is assignment metadata, not authorization, tenancy, billing identity, or a proof that the assignee is the only operator allowed to act.
_Avoid_: Mission owner, organization member, permission grant, billing account

**Mission stage**:
A derived Mission phase whose status comes from the progress of its Mission tasks.
_Avoid_: folder, independent state, milestone

**Artifact**:
A file-backed operator-facing file rooted at one filesystem root such as a Repository root or Mission worktree root. Artifact identity comes from file root and path; Mission, stage, task, and Agent execution relationships are explicit metadata, not the reason the Artifact exists.
_Avoid_: document, Mission-only file, output

**Artifact body**:
The transferable payload of an Artifact, presented according to Artifact metadata such as file name and path.
_Avoid_: document content, file content, output body

**Mission artifact**:
An Artifact related to a Mission at mission, stage, or task level.
_Avoid_: the only kind of Artifact, generic file

**Mission-level artifact**:
A Mission artifact that belongs directly to a Mission, such as `BRIEF.md`.
_Avoid_: global artifact, root artifact

**Stage-level artifact**:
A Mission artifact that belongs to a Mission stage, such as `PRD.md` or `SPEC.md`.
_Avoid_: stage document, output file

**Task-level artifact**:
A Mission artifact that belongs to a Mission task, such as a task instruction file.
_Avoid_: task document, instruction file

**Mission task**:
An executable unit of Mission work with instructions, dependencies, lifecycle state, and optional agent executions.
_Avoid_: job, step, todo

**Agent execution**:
A daemon-owned in-memory Entity instance representing one running or recoverable execution of one Agent under an explicit Agent execution scope. It owns execution identity, process lifecycle, structured messages, accepted signals, durable context, and serializable Entity state. A Terminal may be attached as an optional transport, but it is not the Agent execution.
_Avoid_: chat, terminal, env-based routing, AgentExecutor-owned lifecycle

**Agent execution process**:
The OS process or process-like provider session owned by an Agent execution instance, including launch command, args, working directory, process id when available, exit state, and process lifecycle operations.
_Avoid_: terminal, runtime session, adapter lifecycle owner, AgentExecutor process

**Agent execution scope**:
The daemon-owned attachment context for one Agent execution. Supported scopes are system, repository, mission, task, and artifact. Mission and task are scopes, not mandatory Agent execution roots.
_Avoid_: implicit mission ownership, required task execution, env-based routing

**Agent execution context**:
The durable daemon-managed set of artifacts, Entity references, and instructions made available to an Agent execution, including their roles and ordering.
_Avoid_: prompt text, loose context, implicit context, Mission task list order

**Agent execution token**:
A daemon-issued opaque token that identifies and authorizes one registered Agent execution over the structured transport.
_Avoid_: taskId env var, agentExecutionId env var, routing secret

**Agent execution message**:
A structured non-terminal message sent to an Agent execution through the Open Mission system. The payload carries only message-specific fields. Base Agent execution messages are common, and Agent child adapters may advertise additional supported messages.
_Avoid_: terminal input, raw prompt, CLI text injection, reliable state acknowledgement, transport envelope, hardcoded UI command, slash command

**Agent execution turn**:
One delivered Agent execution message that asks the Agent execution to continue work, such as a launch prompt, follow-up prompt, resume, checkpoint, or nudge. A turn starts when the daemon accepts and delivers the message, and it remains awaiting agent response until a meaningful Agent observation clears it.
_Avoid_: chat turn, terminal turn, agent-authored acknowledgement, lifecycle state

**Awaiting agent response**:
The semantic AgentExecution activity where the daemon has delivered a turn-starting message and is waiting for the Agent execution's next meaningful observation. It is an activity state, not a lifecycle state or a proof that the Agent understood the message.
_Avoid_: running synonym, idle opposite, lifecycle state, transport acknowledgement

**Terminal**:
A daemon-addressable Entity for one PTY-backed terminal transport. TerminalRegistry lives in the Terminal Entity boundary and remains the in-memory authority for terminal screen state, terminal input, resize, exit observation, and update publication. A Terminal may be attached to an Agent execution process, but it does not own AgentExecution lifecycle or Agent process authority.
_Avoid_: Agent execution, runtime session, adapter lifecycle owner, process owner

**Agent execution log**:
The durable daemon-owned audit material retained for an Agent execution. Agent execution logs include semantic interaction journals and raw terminal recordings, which have different authority. Logs are not Mission artifacts by default.
_Avoid_: Mission artifact, Agent execution message Entity, context state, single transcript source of truth

**Agent execution interaction journal**:
The append-only semantic journal for one Agent execution. It records accepted Agent execution messages, normalized observations, policy decisions, state effects, owner effects, and projection material so AgentExecution state can be replayed deterministically. It is separate from raw terminal recordings and Mission workflow event logs.
_Avoid_: terminal transcript, chat state, Mission workflow event log, Agent execution message Entity

**Agent execution fact**:
A daemon-observed structured fact about an Agent execution, such as an artifact read, artifact write, tool invocation, tool result, filesystem change, or structured provider event. An Agent execution fact is not an Agent-authored signal and not raw transport evidence.
_Avoid_: inferred terminal text, Agent claim, UI hint

**Agent execution transport evidence**:
Raw or near-raw adapter, provider, or terminal material retained for audit and optional operator expansion, such as output chunks, stderr excerpts, provider payloads, or PTY snippets. Transport evidence is not semantic truth unless separately promoted into a journaled Agent execution fact or accepted observation.
_Avoid_: canonical replay state, inferred fact, chat message

**Agent execution terminal recording**:
The raw PTY audit record for one terminal-backed Agent execution, including input, output, resize, and exit records. It is transport truth, not semantic interaction truth.
_Avoid_: interaction journal, chat transcript, workflow event log, Agent execution state

**Agent execution message descriptor**:
A daemon-published description of one supported Agent execution message, including its type, label, input shape, delivery behavior, and whether it mutates Agent execution context.
_Avoid_: boolean capability, UI method, runtime method

**Agent execution interaction posture**:
A daemon-published classification of how one Agent execution is operated: structured interactive, structured headless, or native terminal escape hatch. It tells surfaces which control lanes are canonical without changing AgentExecution lifecycle state.
_Avoid_: launch mode, lifecycle state, terminal status, adapter type

**Agent execution command portability**:
The portability classification for one Agent execution message descriptor: Mission-native, cross-Agent, adapter-scoped, or terminal-only. It tells surfaces how broadly a command can be understood without making provider-specific terminal commands canonical Mission operations.
_Avoid_: adapter capability boolean, UI grouping, provider command name, command success state

**AgentExecution projection**:
A read model derived from AgentExecution semantic state and journal records for surfaces such as Open Mission chat, timeline, status badges, and grouped activity views. It is not durable AgentExecution truth.
_Avoid_: source of truth, transcript store, workflow state

**AgentExecutionProcess**:
The OS process or process-like provider session owned by an AgentExecution instance, including process identity when available, attached terminal transport identity, active tool calls, in-flight message delivery, exit state, and heartbeat data. It is the process owned by AgentExecution, not a separate AgentExecution runtime model. Storage decides which process fields are durable enough to persist.
_Avoid_: AgentExecution runtime snapshot, runtime session, interaction journal, workflow event, projection truth, Terminal-owned lifecycle

**AgentExecutionProcess health**:
A daemon-owned reconciliation assessment of whether an AgentExecutionProcess and optional transports are attached, detached, degraded, orphaned, protocol-incompatible, or currently reconciling. AgentExecutionProcess health governs commandability and diagnostics; it is not AgentExecution lifecycle failure unless daemon evidence proves the AgentExecutionProcess is dead or unrecoverable.
_Avoid_: AgentExecution runtime health, terminal status, lifecycle state, agent claim, client protocol error

**Daemon runtime supervisor**:
The daemon-owned runtime coordination authority for live Repository, Mission, Task, Agent execution, and runtime lease relationships started by the Open Mission system. It owns runtime cleanup, cascading cancellation, startup reconciliation, and shutdown hygiene for daemon-started resources.
_Avoid_: surface manager, log reader, process poller, UI coordinator

**Daemon runtime ownership graph**:
The daemon-owned runtime structure that records which live runtime resources belong together, for example which Task owns an Agent execution and which Agent execution owns one or more runtime leases such as PTY terminals or child processes. It is the source for cascading lifecycle handling, not the OS process table or logs.
_Avoid_: transcript tree, surface selection state, ad hoc registry map, log-derived process list

**Runtime lease**:
A daemon-owned claim over one live resource started by the Open Mission system, such as an Agent execution process, PTY terminal transport, socket, or future provider session. A Runtime lease records ownership and cleanup responsibility so the daemon can reconcile stale resources after crashes and release them during shutdown or cancellation. For Agent executions, the AgentExecution instance remains the process lifecycle owner.
_Avoid_: raw PID, terminal tab, adapter state, audit log line, lifecycle owner

**System status snapshot**:
A daemon-owned diagnostic read model for current Mission runtime posture, host process health, dependency readiness, runtime supervision counts, and runtime reconciliation counts. It is operator-facing status material, not durable workflow truth, audit history, or a metrics pipeline.
_Avoid_: telemetry source of truth, observability backend, workflow state, log replay, Prometheus scrape target

**Agent adapter delivery**:
A best-effort attempt to send an Agent execution message to an Agent adapter; it is not proof that the indeterministic Agent execution read, understood, applied, or structurally acknowledged the message.
_Avoid_: context mutation, state acknowledgement, reliable command result

**Agent connection test**:
A daemon-owned one-shot readiness probe for one Agent adapter that reuses the adapter's real launch semantics, runs without creating a managed AgentExecution, and returns a typed diagnostic result for operator use.
_Avoid_: fake AgentExecution, raw terminal poke, surface-owned smoke test, REST health check

**Agent connection diagnostic**:
The typed outcome of an Agent connection test, including success, auth failure, spawn failure, timeout, invalid model selection, or unknown failure with bounded detail.
_Avoid_: transcript, audit log, AgentExecution signal, terminal status line

**Agent model selection**:
The provider-native model and reasoning selection surface exposed by a running Agent session, currently reached through the terminal-only `/model` command advertised by the active AgentExecution protocol descriptor. It is runtime-owned session behavior, not adapter-declared Agent metadata and not setup-time owner settings UI.
_Avoid_: adapter model catalogue, static model list, setup card model selector

**Mission protocol marker**:
A strict one-line stdout marker emitted by an Agent execution and parsed by the daemon as an advisory Agent execution signal. The marker starts with the Mission protocol prefix and carries strict JSON with Mission id, task id, Agent execution id, event id, and signal payload.
_Avoid_: prose state claim, hidden side channel, workflow authority, terminal heuristic

**Mission MCP server**:
The daemon-owned local MCP server named `open-mission-mcp` that exposes Agent signal payloads and Agent execution semantic operations as tools for running Agent executions. It is a structured transport into Agent execution observation routing and scoped semantic reads, not a workflow authority, Entity command surface, public repository API, or separate Agent execution model.
_Avoid_: remote mission API, MCP-owned workflow, task session server, provider-specific signal model

**Agent execution semantic operation**:
A read-only daemon-owned operation exposed to one registered Agent execution through `open-mission-mcp`, such as Artifact reads, code search, symbol context, impact analysis, route impact, or tool context. It resolves authority from Agent execution scope, validates operation input, delegates to the owning daemon service, returns structured context, and records a bounded Agent execution fact.
_Avoid_: Entity command, raw repository API, workflow mutation, arbitrary filesystem tool, public MCP tool

**Code root**:
A filesystem root containing source code that Mission may index for scoped Agent execution semantic operations. A Code root may be a Repository root or a Mission worktree root, but the code intelligence indexer and graph store treat both identically after scope resolution.
_Avoid_: repository-only index root, mission-only index root, product workspace, raw filesystem API

**Code intelligence index**:
A daemon-owned derived read model over one Code root that records source files, code symbols, routes, tools, heuristic processes, clusters, and typed code relationships for scoped Agent execution semantic operations. It is rebuildable from Code root files and Git state, not canonical Mission state.
_Avoid_: Entity storage records, Mission dossier, `.gitnexus` index, workflow truth, source of truth, Repository code intelligence index, Mission code intelligence index

**Code graph**:
The graph-shaped query model inside a Code intelligence index, containing code files, code symbols, code relations, code routes, code tools, code processes, code clusters, and index snapshot metadata. Its physical storage may use SurrealDB tables and relation records behind a Mission-owned graph store adapter, with SurrealQL schema generated from Mission-owned Zod schemas annotated with `@flying-pillow/zod-surreal` metadata.
_Avoid_: raw SurrealDB client, public graph API, Entity relationship metadata, workflow graph, Repository code graph, Mission code graph

**Code intelligence Agent execution fact**:
A bounded Agent execution fact recording that an Agent execution used a code intelligence semantic operation, including the operation name, scoped index, query summary, result summary, staleness, and confidence metadata. It is audit material, not the full query result or source body.
_Avoid_: transcript, full code dump, persistent index record, workflow event

**Agent message shorthand**:
Operator-facing syntax that parses into an Agent execution message, such as a slash command in an external prompt field.
_Avoid_: Agent execution message, terminal command, canonical command

**Agent message shorthand parser**:
Daemon-owned parser that resolves Agent message shorthand into a structured Agent execution message or daemon-owned context operation.
_Avoid_: surface parser, UI command handler, terminal parser

**Terminal input**:
Raw input sent to an Agent execution's terminal-backed CLI surface.
_Avoid_: Agent execution message, structured command

**External agent prompt field**:
A surface input outside the terminal pane that always submits an Agent execution message, even when the operator enters plain text.
_Avoid_: terminal input field, raw CLI input, secondary terminal

**Agent-session artifact**:
A curated Mission artifact produced by or attached to one Agent execution, such as a transcript summary, extracted test output, patch summary, or generated implementation note. It may reference or extract from an Agent execution log, but it is not the raw log itself.
_Avoid_: raw Agent execution log, terminal output, ephemeral log, session state, copied promotion artifact

### Entity Remote

**Entity**:
A daemon-addressable domain object in the Open Mission system with an Entity class, Entity id, schemas, and remote methods. An Entity is authoritative for its own domain behavior and invariants; it is not a passive data shape with behavior owned elsewhere.
_Avoid_: model, component, resource

**Entity id**:
A daemon-owned identifier in `table:uniqueId` form for an Entity.
_Avoid_: id string, context id, UI id

**Entity channel**:
A daemon-owned event channel in `table:uniqueId.event` form for Entity notifications.
_Avoid_: event type, topic, subscription key

**Entity schema**:
The serializable payload and result contract for Entity remote methods.
_Avoid_: contract, adapter, implementation

**Entity class**:
The TypeScript class that implements one Entity's authoritative behavior, invariants, identity access, data lifecycle, and remote method targets.
_Avoid_: adapter, facade, data wrapper, model

**Entity contract**:
Daemon-readable metadata that binds an Entity class to remote methods, payload schemas, result schemas, events, execution mode, and UI presentation metadata. It routes calls to the Entity class; it does not own domain behavior.
_Avoid_: behavior implementation, surface command handler, schema module

**Entity input schema**:
The caller-provided command or query payload shape for creating or changing an Entity.
_Avoid_: form schema, request schema

**Entity storage schema**:
The persisted Entity shape, currently JSON-backed but designed to map cleanly to future database records.
_Avoid_: database model, table schema

**Entity data schema**:
The hydrated Entity shape returned to clients, including storage fields and computed, linked, or projected fields.
_Avoid_: view model, response model

**Entity command view**:
A first-class Entity query result or hydrated Entity `commands` field that advertises Entity method descriptors for one target Entity id. It is derived from `<Entity>Contract.ts` mutation methods with `ui` metadata and the owning Entity's optional `can<MethodName>` method; it is not persisted Entity storage data.
_Avoid_: command snapshot, command alias, surface command registry, Mission child command list

**Entity class command view**:
A first-class Entity query result that advertises currently available class-level Entity commands, such as Repository registration or clone. It is returned by `classCommands` and is not tied to an existing Entity id.
_Avoid_: source-prefixed command vocabulary, collection command vocabulary, global command vocabulary, command snapshot

**Entity data change event**:
A daemon notification that carries the current Entity data after an Entity changed. It is named `data.changed` and uses a `data` payload when the payload is the Entity data schema itself.
_Avoid_: snapshot changed, entity snapshot event, data snapshot

**Snapshot**:
A point-in-time read model that is not merely an Entity data schema under another name. Use only for System snapshots, terminal snapshots, worktree snapshots, state store snapshots, or aggregate Mission snapshots that compose or observe multiple records or runtime state.
_Avoid_: data alias, changed data, Entity data

**Field metadata**:
Schema-attached metadata that describes persistence, indexing, search, sensitivity, references, and computed values for an Entity field.
_Avoid_: comments, database hints

**Relationship metadata**:
Schema-attached metadata that describes how one Entity relates to another Entity.
_Avoid_: join config, relation comment

**Method metadata**:
Schema-attached metadata that describes an Entity remote method, including access, REST exposure, event publication, and UI presentation.
_Avoid_: route config, command config

**Entity adapter**:
Legacy phrase for outboard daemon-side Entity execution code. Prefer **Entity class** for domain behavior and **Entity contract** for remote method metadata; reserve adapter for external platform or storage translation.
_Avoid_: schema, model, facade, behavior owner

**Mission state store**:
The daemon-owned datastore that persists canonical Entity storage records, Mission runtime data, Agent execution context, and durable Mission coordination state.
_Avoid_: cache, replica, projection store, surface database

**Mission state**:
An informal umbrella phrase only. It is not a schema, persisted document, datastore, or TypeScript type. Use **Mission runtime data** for the MissionRuntime data shape, **Mission dossier state store** for the per-Mission dossier-backed runtime persistence module, **Mission state store** for the daemon-wide datastore that owns accepted state, and **Mission state store snapshot** for a read result from that daemon-wide store.
_Avoid_: MissionState, runtime data, datastore name, schema name

**Mission state store schema**:
A Zod v4 schema owned by the Mission state store module that validates State store transactions, transaction mutations, snapshots, recovery attention, and state-store-owned persisted shapes before adapter code accepts or returns them. Any Mission schema that performs validation must be a Zod v4 schema, and its exported TypeScript data type must be inferred from that schema with `z.infer` rather than hand-written beside it. Mission state store validation is clean-slate: it rejects invalid data and does not run fallback parsers or load-time normalization.
_Avoid_: TypeScript-only type, adapter-local shape, unchecked JSON, SurrealDB-only schema, hand-written validated data type

**State store transaction**:
The small atomic write unit the daemon accepts after validating Entity input commands, workflow commands, or daemon-owned domain intent. It exists to keep validation, persistence, checkpointing, and change publication in one place, not to create a separate transaction-control architecture.
_Avoid_: direct storage mutation, ad hoc database write, private daemon write path, surface transaction

**Daemon in-memory datastore**:
The embedded SurrealDB datastore inside the Open Mission daemon, initially using SurrealMX-backed memory as the fast canonical working store behind the Mission state store.
_Avoid_: surface cache, browser database, external database server

**State store persistence policy**:
The daemon-owned durability rule for the Mission state store, such as append-only log, snapshot, SurrealKV, RocksDB, export, or dossier-backed persistence.
_Avoid_: ad hoc flush, surface backup, replica sync

**Mission dossier-backed persistence**:
The State store persistence policy where the Mission dossier remains the canonical durable recovery format, while the Daemon in-memory datastore is hydrated once and then kept current as the live working store.
_Avoid_: JSON live store, dual canonical storage, surface persistence

**State store hydration**:
The daemon-owned startup or resume operation that reads a Mission dossier into the Daemon in-memory datastore before live Mission work continues.
_Avoid_: repeated JSON reads, surface bootstrap, replica sync

**Mission dossier checkpoint**:
A daemon-owned direct write that records each accepted State store transaction back into the Mission dossier for durable recovery.
_Avoid_: batched checkpoint by default, synchronous surface save, replica flush, second write path

**Mission checkpoint failure**:
A failed Mission dossier checkpoint after a State store transaction has already been accepted by the daemon.
_Avoid_: automatic rollback, hidden data loss, agent checkpoint emulation

**Mission recovery attention**:
A daemon-owned non-blocking Mission condition indicating that accepted in-memory state may be ahead of durable Mission dossier persistence and requires daemon diagnostics or daemon recovery handling.
_Avoid_: Mission control view status, rollback state, mutation pause, surface error only, ignored persistence failure

**Entity storage record**:
The persisted record shaped by an Entity storage schema and owned by the Mission state store.
_Avoid_: snapshot, data schema, surface copy

**Entity input command**:
A daemon-accepted mutation request validated by an Entity input schema and applied through a State store transaction before it changes Entity storage records.
_Avoid_: local database write, storage patch, replica mutation

**Entity data view**:
The hydrated read shape produced from Entity storage records and Entity data schema rules, including computed or linked fields when needed.
_Avoid_: storage record, replicated record, source of truth

**Surface state replica**:
An Open Mission surface/client-local datastore that may cache or mirror daemon-published Entity storage records for local querying, reconnect, or offline read behavior.
_Avoid_: canonical state, second daemon, surface-owned Mission state

**Entity change stream**:
A daemon-published sequence of Entity storage record changes that can update a Surface state replica or client-side Entity instances.
_Avoid_: projection stream, RPC response stream, UI event log

**Replication cursor**:
A surface-held position in an Entity change stream used to request changes since the last applied daemon-published change.
_Avoid_: schema version, protocol version, runtime migration

**Entity command outbox**:
A surface-local queue of Entity input commands waiting to be submitted to the daemon when immediate delivery is unavailable.
_Avoid_: local storage mutation, conflict resolver, offline source of truth

### Runtime Communication

**System snapshot**:
A daemon-owned read model of current Open Mission system state used for bootstrapping and reconnecting clients.
_Avoid_: projection, full mission projection

**Daemon protocol version**:
The wire-compatibility version used by Open Mission surfaces and daemon clients to decide whether they can talk to the running Open Mission daemon.
_Avoid_: Mission runtime schema version, Entity schema version, workflow version

**Entity event**:
A fine-grained daemon notification that communicates a change to one Entity.
_Avoid_: projection update, partial projection

**Open Mission app pane view**:
A daemon-derived view of one Open Mission pane for a surface to render.
_Avoid_: pane projection

**Mission control view**:
A daemon-derived operator view for one Mission that contains Mission status and workflow snapshots for Open Mission surfaces.
_Avoid_: mission projection

**Mission control selection**:
The Open Mission surface-controlled operator focus for one Mission, such as active Mission stage or Mission task.
_Avoid_: tree node selection, durable Mission coordination state, shared operator focus

**Raw mission control selection**:
The current surface/operator focus target before Open Mission resolves the companion work bundle.
_Avoid_: pane route state, durable Mission state, resolved work bundle

**Resolved mission control selection**:
The Open Mission app-resolved companion work bundle derived from raw Mission control selection and semantic Mission relationships, such as active instruction artifact, active stage result artifact, or active Agent execution.
_Avoid_: filename heuristic, tree-order heuristic, persisted pane state

**Mission surface preference**:
An Open Mission surface/client-local affordance such as panel sizes, selected stage tab, or temporary focus that does not change Mission runtime data, Entity storage records, or Agent execution context.
_Avoid_: durable Mission state, daemon preference, workflow setting

**Derived workflow state**:
Workflow runtime state derived from Mission tasks, such as Mission stage state and gate state.
_Avoid_: workflow projection, stage projection

## Relationships

- The **Open Mission system** coordinates one or more **Missions**.
- The **Open Mission app** is hosted by one or more **Open Mission native hosts**.
- An **Open Mission native host** consumes daemon and **Open Mission app model layer** contracts; it does not own Mission truth.
- A live **Mission** is executed by exactly one **Running Mission instance** in the daemon.
- A **Repository** may have one **GitHub repository ref**.
- A **Repository** has exactly one **Repository root**.
- **Repository control state** belongs to exactly one **Repository**.
- A **Repository** may define one **Mission workflow definition** used by its **Running Mission instances**.
- A **Repository settings document** contains **Repository workflow settings**.
- **Repository workflow settings** are daemon-owned Repository policy and are edited through **Control mode** commands.
- **Repository workflow settings** are snapshotted into **Mission runtime data** when a draft **Mission** becomes ready.
- A **Mission** has exactly one **Mission branch ref**.
- A **Remote mission branch ref** corresponds to one **Mission branch ref** on a remote Git host.
- A **Mission worktree** is materialized from one **Mission branch ref**.
- A **Mission worktree** has exactly one **Mission worktree root**.
- A **Repository** uses a **Git adapter** for local Git operations at its **Repository root**.
- A **Repository root** may resolve to a **Code root** for scoped code intelligence.
- A **Repository** uses a **GitHub adapter** for hosted operations against its **GitHub repository ref**.
- A **Mission worktree** uses a **Git adapter** for local Git operations at its **Mission worktree root**.
- A **Mission worktree root** may resolve to a **Code root** for scoped code intelligence.
- A **Code intelligence index** belongs to exactly one **Code root**.
- A **Code graph** belongs to exactly one **Code intelligence index** snapshot.
- A **Code intelligence index** is derived read material and must not replace repository files, Git state, Mission dossiers, Entity storage records, or workflow events as source of truth.
- Hosted pull request and issue operations use the **GitHub adapter** against a **GitHub repository ref**.
- A **Mission** has exactly one **Mission dossier**.
- A **Mission dossier** contains **Mission runtime data** and the Mission runtime event log.
- A **Mission dossier state store** validates and checkpoints Mission runtime data changes for one **Mission dossier**.
- A filesystem adapter may read and write raw Mission dossier files, but it does not validate **Mission runtime data**.
- **Mission runtime data** has one **Mission runtime schema version**.
- A **Mission runtime schema version** applies to the whole persisted Mission runtime data, not separately to **Agent execution context** or **Mission artifacts**.
- A **Mission runtime migration**, if introduced by an explicit future decision, belongs to the daemon persistence layer and must run outside ordinary State store hydration.
- A **Mission** has one or more **Mission stages**.
- A **Mission stage** status is derived from its **Mission tasks**.
- An **Artifact** is rooted at one filesystem root such as a **Repository root** or **Mission worktree root**.
- An **Artifact** may exist without any **Mission** relationship.
- A **Mission artifact** may belong to a **Mission**, a **Mission stage**, or a **Mission task**.
- A **Mission-level artifact** belongs directly to one **Mission**.
- A **Stage-level artifact** belongs to one **Mission stage**.
- A **Task-level artifact** belongs to one **Mission task**.
- A **Mission task** belongs to exactly one **Mission stage**.
- An **Agent execution** belongs to one explicit **Agent execution scope**: system, repository, mission, task, or artifact.
- A task-scoped **Agent execution** belongs to one **Mission task**; mission, repository, system, and artifact scopes do not imply a task.
- An **Agent execution context** belongs to one **Agent execution**.
- An **Agent execution context** contains explicit artifact and Entity references; it is not inferred from prompt text.
- An **Agent execution context** owns the order of artifacts and instructions made available to its **Agent execution**.
- An **Agent execution message** is accepted through the daemon, not by writing raw text directly into an Agent execution terminal; the daemon resolves the session from its token instead of env-passed ids.
- **Agent adapter delivery** is best-effort and must not be treated as proof that an **Agent execution** applied a context change.
- An **Agent execution message** is not a first-class durable Entity unless the Open Mission system later needs queryable structured message history.
- An **Agent execution log** records delivered Agent execution interaction, while **Agent execution context** records lasting context state.
- An **Agent execution log** is daemon-owned audit material, not an **Artifact** by default.
- An **Agent execution semantic operation** belongs to one registered **Agent execution** and is authorized through that Agent execution's `open-mission-mcp` access.
- An **Agent execution semantic operation** records a bounded **Agent execution fact** when it reads meaningful context.
- A code intelligence semantic operation may read a **Code intelligence index** only for the **Code root** resolved from the **Agent execution scope**.
- An **Agent-session artifact** may reference or extract from an **Agent execution log** when the daemon or operator promotes useful material into Mission work.
- An **Agent execution message** describes a structured message supported by an Agent execution's Agent adapter.
- An **Agent execution token** is the daemon-issued identifier used for structured transport and registration.
- An **Agent execution message descriptor** is the source of truth for which structured controls a surface may offer for an **Agent execution**.
- A task-scoped **Agent execution** receives mandatory **Mission protocol marker** instructions in its initial prompt.
- An **Agent message shorthand** is not canonical; it parses into an **Agent execution message** backed by an **Agent execution message descriptor** or daemon-owned context operation.
- An **Agent message shorthand parser** belongs to the daemon; surfaces may offer autocomplete or previews but do not define canonical parse results.
- Base **Agent execution messages** are common across Agent adapters; Agent child adapters may advertise additional supported messages.
- Daemon-owned context messages may update **Agent execution context** before any optional delivery to an Agent adapter.
- A daemon-accepted **Agent execution context** mutation is canonical even when related **Agent adapter delivery** fails, is ignored, or receives no structured response.
- Agent responses may be recorded as **Agent execution log** observations, but they must not be used as authoritative context state unless modeled as separate daemon-validated state.
- **Terminal input** is reserved for direct CLI interaction and does not define canonical Agent execution context.
- An **External agent prompt field** always submits an **Agent execution message**; only focused terminal interaction sends **Terminal input**.
- An **Agent-session artifact** belongs to one **Agent execution**.
- Raw **Agent execution logs** do not appear as Artifacts by default.
- An **Agent-session artifact** remains the same canonical **Artifact** when it becomes useful beyond its producing **Agent execution**; Mission records relationships instead of copying it.
- An **Entity** has exactly one canonical `id` field in its **Entity schema**.
- An **Entity storage schema** carries the canonical `id`, entity type, audit fields, and storage-facing **Field metadata**.
- An **Entity data schema** may include computed or linked fields described by **Field metadata**.
- Entity schemas use the standard role names **Entity input schema**, **Entity storage schema**, and **Entity data schema**.
- An **Entity class** owns behavior and invariants for its Entity.
- An **Entity contract** binds remote methods and presentation metadata to an **Entity class** without becoming the behavior owner.
- An **Entity input command** is validated by an **Entity input schema** and applied by the daemon before any **Entity storage records** change.
- An **Entity storage record** is shaped by an **Entity storage schema** and is the only Entity record shape eligible for durable replication.
- An **Entity data view** is shaped by an **Entity data schema** and may be derived in the daemon or a **Surface state replica**, but it is not replicated as canonical state.
- **Relationship metadata** records Entity relationships separately from ad hoc path or filename inference.
- **Method metadata** records remote method access, publication, and presentation semantics without putting those rules in surface code.
- The **Mission state store** owns canonical Entity storage records and durable Mission coordination state.
- **Mission state store schemas** validate State store transaction descriptors, transaction mutations, snapshots, recovery attention, and state-store-owned persisted shapes.
- A **State store transaction** is the only canonical write interface for the **Mission state store**.
- **Entity input commands**, workflow commands, and daemon-owned domain intent are applied through **State store transactions** before storage records change.
- Daemon internals must not bypass **State store transactions** with direct **Entity storage record** writes.
- The **Daemon in-memory datastore** is the first intended Mission state store adapter and keeps canonical working state inside the Open Mission daemon.
- A **State store persistence policy** belongs to the daemon and determines how the Daemon in-memory datastore is made durable or recoverable.
- **Mission dossier-backed persistence** is the first State store persistence policy.
- **State store hydration** reads the **Mission dossier** once when the daemon starts or resumes a Mission; live reads and queries should use the **Daemon in-memory datastore** after hydration.
- A **Mission dossier checkpoint** updates the **Mission dossier** after every accepted **State store transaction**.
- A **Mission checkpoint failure** does not roll back the accepted **State store transaction**.
- **Mission recovery attention** records in daemon diagnostics that the **Daemon in-memory datastore** may be ahead of the durable **Mission dossier**.
- **Mission recovery attention** does not stop the daemon from accepting new **State store transactions**.
- **Mission recovery attention** is not part of the **Mission control view** by default.
- A **Surface state replica** may store daemon-published **Entity storage records**, but it must not become a canonical Mission state store.
- An **Entity change stream** carries daemon-published storage changes for connected updates or replay into a **Surface state replica**.
- A **Replication cursor** belongs to a surface/client and identifies which **Entity change stream** changes it has applied.
- An **Entity command outbox** stores **Entity input commands** only; it must not write canonical **Entity storage records** locally.
- An **Entity id** identifies one **Entity**.
- An **Entity channel** belongs to one **Entity id**.
- An **Entity contract** routes remote methods described by Entity schemas to an **Entity class**.
- A **System snapshot** bootstraps client state before **Entity events** keep it current.
- An **Open Mission app pane view** is derived from daemon-owned Open Mission state.
- A **Mission control view** is derived from Entity data, workflow definition, and runtime state for operator navigation.
- A **Mission surface preference** belongs to the Open Mission surface/client layer, not the daemon.
- A **Mission surface preference** must not encode durable Mission workflow ordering.
- Mission Control task lists are rendered by Open Mission surfaces from Mission stage, Mission task, Artifact, Agent execution, and Entity command descriptors.
- Mission Control task lists must not duplicate canonical labels, lifecycle state, artifact paths, task status, or agent execution details owned by Entities.
- A **Mission control selection** is controlled by one surface/operator session and resolved by Open Mission against Entity data.
- A **Mission control selection** is not durable Mission coordination state and must not be shared as the current focus for every surface.
- A **Raw mission control selection** resolves to one **Resolved mission control selection** for companion panes.
- **Resolved mission control selection** is derived view state; it is not persisted as pane state.
- Agent execution context artifacts are displayed from **Agent execution context** and Entity relationships; **Agent execution context** owns ordered artifact references.
- **Entity events** update client-side Entity instances; **Mission control view** updates daemon-derived Mission status and workflow snapshots.
- **Derived workflow state** is recomputed from **Mission task** progress and is not independently edited.

## Architecture Boundaries

### Agent Execution Context Synchronization

- The Open Mission daemon is the single source of truth for Agent execution context and Mission artifact state.
- Open Mission surfaces and panes subscribe to daemon-driven updates and never own or persist Agent execution context independently.
- Updates are daemon-published: the daemon notifies all surfaces of changes, ensuring multi-pane consistency.
- Surfaces may send selection or action hints, but the daemon resolves and rebroadcasts canonical state.

### Agent Execution Context Ordering

- Agent execution context ordering is durable Agent execution state managed by the daemon.
- The order of artifacts and instructions in Agent execution context is part of the Agent execution's working context and audit trail.
- Reordering Agent execution context must call daemon commands that mutate Agent execution context.

### Agent Adapter Delivery

- Agent executions are indeterministic and may ignore, misunderstand, or fail to structurally acknowledge delivered messages.
- Agent execution context mutations become canonical when accepted by the daemon, not when acknowledged by the Agent adapter.
- Agent adapter delivery is optional, descriptor-defined, and best-effort.
- Mission must distinguish daemon-accepted context mutation, runtime delivery attempt, runtime output observation, and operator/system interpretation of that output.
- Agent adapter responses are observations in the Agent execution log unless a future daemon-validated state model explicitly promotes them.

### Agent Execution Semantic Operations And Code Intelligence

- `open-mission-mcp` may expose Agent execution semantic operations alongside Agent signal tools for registered Agent executions.
- Agent execution semantic operations are read-only by default and must not mutate Entity storage records, Mission workflow state, repository files, Git refs, or Open Mission surface state.
- Semantic operation availability is scoped by Agent execution scope, selected Agent adapter capability, daemon policy, and operation-specific requirements.
- The Mission MCP bridge must proxy semantic operation inputs directly; it must not assume every MCP tool is an Agent signal payload.
- Code intelligence belongs to a daemon-owned Code intelligence service and Code graph store, not to MCP handlers or Open Mission surfaces.
- Code intelligence indexes are rebuildable read models over Code roots and must report staleness when stale data could affect the answer.
- Code graph SurrealQL DDL is generated from Mission-owned zod-surreal schemas; hand-written SurQL is not the canonical code graph schema.
- Open Mission web may render a read-only visual representation of active Code graph snapshots after Agent-facing semantic operations are stable, but it must not own graph semantics, index lifecycle, root selection, or graph mutation.
- Code intelligence Agent execution facts record bounded audit summaries of semantic operation use; full source bodies and high-volume graph results are returned only in operation responses when allowed, not stored wholesale in Agent execution facts.

### Mission Control Task List

- Mission Control task lists are Open Mission surface views over Mission stages, Mission tasks, Artifacts, Agent executions, and Entity command descriptors.
- Mission Control task lists are filtered by the selected Mission stage and default to the active Mission stage.
- Open Mission surfaces may keep selected stage tabs and temporary focus locally, but they must not persist task-list structure as Mission state.
- Mission Control task cards submit Entity commands through canonical Entity command descriptors; they do not define workflow legality.
- Mission surface preferences are local Open Mission surface/client state only.
- The daemon must not store Mission surface preferences.

### Mission Control Selection

- Mission control selection is surface-controlled and Open Mission app-resolved from Entity data.
- Open Mission validates and normalizes requested selection against client-side Entity instances so surfaces do not invent invalid focus.
- Selection is not durable Mission coordination state; one operator's current focus must not change every other surface's current focus.
- Shared Mission navigation state belongs in canonical Entity relationships, not selection.

### Agent Execution Context Lifecycle

- When an Agent execution ends through completion, cancellation, or termination, the daemon updates session state and disposes runtime resources.
- Agent execution logs are flushed and persisted as daemon-owned audit material; they are not deleted automatically and they are not Mission artifacts by default.
- Curated outputs derived from Agent execution logs become Agent-session artifacts only through an explicit daemon or operator promotion action.
- Mission artifacts referenced by Agent execution context are retained unless explicitly deleted by operator action or workflow.
- Surfaces update reactively; cleanup and retention logic is daemon-owned.

### Concurrent Agent Execution Context Updates

- The Open Mission daemon serializes Agent execution context and Mission artifact updates.
- Concurrent updates are resolved by last-write-wins; there is no explicit locking, merge strategy, or user-facing conflict resolution.
- Surfaces must reactively update to reflect the latest daemon state.

### Mission Workflow Runtime Schema Versioning

- Agent execution context and Mission artifacts do not have independent persisted schema versions today.
- Persisted workflow runtime state is versioned by the **Mission runtime schema version** on the **Mission runtime data**.
- The daemon persistence layer rejects unsupported Mission runtime schema versions instead of allowing surfaces to interpret stale state.
- Future replacements of Mission runtime data layouts require explicit **Mission runtime migrations** or conversion commands; ordinary State store hydration rejects invalid data and does not repair it.
- Open Mission surfaces rely on Entity schemas, System snapshots, Entity events, and the **Daemon protocol version** for runtime compatibility; they do not run Mission runtime migrations.

### Mission State Store And Surface Replication

- The Mission state store is the canonical owner of Entity storage records, Mission runtime data, Agent execution context, and other durable Mission coordination state.
- The current **Mission dossier state store** is a narrower per-Mission runtime module and must not be treated as the daemon-wide Mission state store.
- Mission state store schemas are written with Zod v4 and live in schema modules separate from state store adapter classes. Any shape that needs validation must have a Zod v4 schema as the source of truth, and exported TypeScript data types for validated shapes must be inferred with `z.infer` from those schemas. This keeps validation local to the Mission state store interface and prepares the same shapes for future SurrealDB database schema generation or mapping.
- The State store transaction is a small atomic write boundary for the Mission state store. Entity input commands, workflow commands, and daemon-owned domain intent are validated and applied through State store transactions before records change.
- State store transactions must stay simple: they group validation, storage writes, checkpointing, and change publication for one accepted write, but they do not introduce a separate event-sourcing model, replay model, or transaction-control architecture.
- Daemon modules must not write Entity storage records or durable Mission coordination state directly. SurrealDB is the storage engine behind the State store transaction interface, not a shared database client for arbitrary daemon modules.
- The first Mission state store adapter should be a Daemon in-memory datastore using embedded SurrealDB with SurrealMX-backed memory.
- The Daemon in-memory datastore is canonical working state, not a cache in front of another in-process model.
- The first State store persistence policy is Mission dossier-backed persistence: the daemon performs State store hydration once when starting or resuming a Mission, then live work reads and writes the Daemon in-memory datastore.
- Mission dossier checkpoints run after every accepted State store transaction because Mission data is currently small and direct persistence is simpler than batching. Mission must not treat the Mission dossier as a repeatedly-read live store during active daemon execution.
- If a Mission dossier checkpoint fails after a State store transaction was accepted, Mission does not roll back the accepted transaction. Agent executions and Agent adapters may already have changed files in the Mission worktree, and the Mission state store cannot emulate each agent adapter's checkpoint or rollback semantics.
- A Mission checkpoint failure places the Mission in Mission recovery attention while keeping the Daemon in-memory datastore live so the daemon can retry, record diagnostics, or run recovery handling.
- Mission recovery attention is non-blocking: the daemon continues to accept new State store transactions while persistence recovery is pending, unless a separate future safety policy explicitly pauses a Mission.
- Mission recovery attention is daemon-only by default. Open Mission surfaces do not receive it through Mission control view, System snapshot, or Entity data unless a future operator-facing recovery design explicitly promotes it.
- Batching, debouncing, or lifecycle-only checkpoints are future State store persistence policy optimizations and require a new decision before replacing direct checkpoints.
- SurrealDB capabilities remain available for live querying, indexing, relationships, change streams, and in-memory working state. Configured SurrealDB memory persistence, SurrealKV, RocksDB, or export/import may be added as recovery optimizations, but they must not replace the Mission dossier as the canonical durable recovery format without a new ADR.
- The daemon owns the State store persistence policy; surfaces and replicas must not define persistence for the Mission state store.
- Open Mission surfaces may maintain a Surface state replica for local querying, reconnect, or offline read behavior, but a replica must be populated from daemon-published Entity storage records and Entity change streams.
- Entity RPC methods remain the surface mutation interface: surfaces submit Entity input commands to the daemon, and the daemon validates and applies those commands through State store transactions before storage changes are checkpointed and published.
- A future offline surface may queue Entity input commands in an Entity command outbox, but replay must go through the daemon before changes become canonical.
- Surface state replicas replicate Entity storage records only. Entity data views are derived read surfaces and must not be treated as replicated source of truth.
- Replication cursors track delivery progress through Entity change streams; they do not replace Mission runtime schema versions, daemon protocol versions, or daemon-owned migrations.
- The datastore implementation may later add SurrealDB/WASM in a surface, but all datastore adapters must preserve daemon authority over the Mission state store.

## Example Dialogue

> **Dev:** "When the **Open Mission system** starts, should it resume every **Mission**?"
> **Domain expert:** "No. The **Open Mission system** may discover many **Missions**, but each **Mission** keeps its own execution state."

## Flagged Ambiguities

- "Mission" was used to mean both the product/system and a long-lived unit of work. Resolved: **Mission** means the unit of work; **Open Mission** means the product/runtime.
- "Repository" can be confused with a checked-out mission worktree. Resolved: **Repository** means the base Git checkout, not a mission checkout.
- "Branch" was used to mean both a Git ref and a checked-out worktree. Resolved: names or refs use **Ref**; local checked-out Git work uses **Mission worktree**; filesystem locations use **Root** or **Path**.
- "Stage" can sound like a materialized folder or independently edited state. Resolved: **Mission stage** is derived from **Mission task** progress.
- Entity schemas used entity-specific id field names such as `repositoryId` or `missionId`. Resolved: an **Entity schema** uses a canonical `id` field for the Entity's identity.
- Entity behavior was described as if an outboard **Entity adapter** satisfied remote methods. Resolved: the **Entity class** is the behavior owner, while the **Entity contract** holds remote method metadata.
- "Projection" was used for old coarse-grained mission synchronization, Open Mission pane data, and workflow-derived state. Resolved: **Projection** is legacy/transition vocabulary; use **System snapshot**, **Entity event**, **Open Mission app pane view**, **Mission control view**, or **Derived workflow state**.
- "Prompt" was used for both raw CLI input and structured operator intent. Resolved: use **Terminal input** for raw CLI bytes and **Agent execution message** or **Agent execution message** for structured daemon-mediated input.
- Agent execution messages could be mistaken for a new durable Entity. Resolved: session logs record delivered interaction, and **Agent execution context** records lasting context state; no separate message Entity is canonical yet.
- Agent adapter support was described with broad boolean capabilities. Resolved: use **Agent execution message descriptors** to advertise supported structured messages and their input shapes.
- Slash commands can look like canonical commands. Resolved: slash commands are **Agent message shorthand** that parse into structured messages or context operations.
- `MissionState` can look like a concrete schema name. Resolved: **Mission state** is only an informal umbrella phrase; schema-facing code names the concrete **Mission runtime data** as `MissionRuntimeData`.
