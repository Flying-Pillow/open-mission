# Mission System

Mission system is a local-first engineering control system for coordinating repository-scoped missions, daemon-owned runtime state, Airport surfaces, and agent runtimes.

## Language

### System

**Mission**:
A long-lived unit of engineering work with a brief, workflow state, artifacts, tasks, and agent sessions.
_Avoid_: project, job, run, workflow

**Mission system**:
The local-first engineering control system that coordinates repositories, missions, daemon-owned runtime state, Airport surfaces, and agent runtimes.
_Avoid_: Mission, app, platform

### Repository Plane

**Platform repository ref**:
The hosted repository identifier used by a repository platform adapter, for example the GitHub ref `Flying-Pillow/mission`.
_Avoid_: Repository, repository root

**GitHub repository ref**:
The GitHub-shaped Platform repository ref, for example `Flying-Pillow/mission`.
_Avoid_: Repository, repository root

**Repository**:
The local checked-out Git repository, preferably on the main branch, that the Mission system uses as the base for Mission worktrees.
_Avoid_: GitHub repository, mission worktree, workspace

**Repository root**:
The filesystem root path of a Repository.
_Avoid_: workspace root, mission worktree root

**Repository control state**:
Durable repository-scoped Mission system state stored under `.mission/`.
_Avoid_: settings, config, workspace state

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
The persisted daemon-owned MissionRuntime data shape for one Mission, including Mission task runtime state, Agent session runtime state, configuration snapshot, and Derived workflow state. Mission runtime data is clean-slate validated: invalid runtime data is rejected rather than repaired through fallback parsing or load-time normalization.
_Avoid_: record, Mission state, Mission runtime module, agent session schema, artifact schema, UI state file

**Mission dossier state store**:
A per-Mission daemon runtime module that accepts validated Mission runtime data changes, keeps live in-memory state for one Mission, and checkpoints Mission runtime data and the Mission runtime event log into the Mission dossier. It is not the daemon-wide Mission state store.
_Avoid_: Mission state store, MissionState, MissionRuntimeDossier, JSON live store

**Mission runtime schema version**:
The schema version of Mission runtime data; it versions the persisted workflow runtime data as a whole, not each Agent session context or Mission artifact separately.
_Avoid_: agent session context version, artifact version, surface protocol version

**Mission runtime migration**:
A deliberate, separately decided replacement of one Mission runtime data layout with another. It is not an implicit fallback parser, load-time normalizer, or hidden compatibility shim.
_Avoid_: surface migration, per-field fallback, ad hoc compatibility shim

**Running Mission instance**:
The daemon-owned in-memory authoritative Mission Entity for one Mission. It owns Mission lifecycle behavior, child-entity coordination, workflow-definition application, and Mission read projection while the Mission is live, and it can run without any Airport surface connected.
_Avoid_: UI session mission, workflow controller, mission projection, surface-owned mission state

**Mission workflow definition**:
The repository-owned validated workflow law that a Running Mission instance applies for stage order, task generation, gate rules, artifact expectations, and execution constraints. Different repositories may use different Mission workflow definitions without introducing different Mission classes or alternate Mission instance models.
_Avoid_: workflow implementation, mission subclass, fallback settings blob, surface workflow

**Mission stage**:
A derived Mission phase whose status comes from the progress of its Mission tasks.
_Avoid_: folder, independent state, milestone

**Mission artifact**:
A tracked human-readable file produced or consumed by a Mission at mission, stage, or task level.
_Avoid_: document, file, output

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
An executable unit of Mission work with instructions, dependencies, lifecycle state, and optional agent sessions.
_Avoid_: job, step, todo

**Agent session**:
A daemon-managed agent execution attached to a Mission, optionally focused on one Mission task.
_Avoid_: chat, terminal, process

**Agent session context**:
The durable daemon-managed set of Mission artifacts and instructions made available to an Agent session, including their roles and ordering.
_Avoid_: prompt text, loose context, implicit context, Mission control outline order

**Agent session message**:
A structured non-terminal message sent to an Agent session through the Mission system.
_Avoid_: terminal input, raw prompt, CLI text injection, reliable state acknowledgement

**Agent session log**:
The durable daemon-owned audit record of interaction sent to and produced by an Agent session runtime; it is not a Mission artifact by default.
_Avoid_: Mission artifact, Agent session message Entity, context state, transcript-only source of truth

**Agent runtime message**:
A structured Agent session message supported by an Agent runtime; base Agent runtime messages are common, and Agent child runtimes may advertise additional messages.
_Avoid_: hardcoded UI command, terminal command, slash command

**Agent runtime message descriptor**:
A daemon-published description of one supported Agent runtime message, including its type, label, input shape, delivery behavior, and whether it mutates Agent session context.
_Avoid_: boolean capability, UI method, runtime method

**Agent runtime delivery**:
A best-effort attempt to send an Agent session message to an Agent runtime; it is not proof that the indeterministic Agent session read, understood, applied, or structurally acknowledged the message.
_Avoid_: context mutation, state acknowledgement, reliable command result

**Agent message shorthand**:
Operator-facing syntax that parses into an Agent session message, such as a slash command in an external prompt field.
_Avoid_: Agent runtime message, terminal command, canonical command

**Agent message shorthand parser**:
Daemon-owned parser that resolves Agent message shorthand into a structured Agent session message or daemon-owned context operation.
_Avoid_: surface parser, UI command handler, terminal parser

**Terminal input**:
Raw input sent to an Agent session's terminal-backed CLI surface.
_Avoid_: Agent session message, Agent runtime message, structured command

**External agent prompt field**:
A surface input outside the terminal pane that always submits an Agent session message, even when the operator enters plain text.
_Avoid_: terminal input field, raw CLI input, secondary terminal

**Agent-session artifact**:
A curated Mission artifact produced by or attached to one Agent session, such as a transcript summary, extracted test output, patch summary, or generated implementation note. It may reference or extract from an Agent session log, but it is not the raw log itself.
_Avoid_: raw Agent session log, terminal output, ephemeral log, session state, copied promotion artifact

### Entity Remote

**Entity**:
A daemon-addressable domain object in the Mission system with an Entity class, Entity id, schemas, and remote methods. An Entity is authoritative for its own domain behavior and invariants; it is not a passive data shape with behavior owned elsewhere.
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
The daemon-owned datastore that persists canonical Entity storage records, Mission runtime data, Agent session context, and durable Mission coordination state.
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
The embedded SurrealDB datastore inside the Mission daemon, initially using SurrealMX-backed memory as the fast canonical working store behind the Mission state store.
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
An Airport surface/client-local datastore that may cache or mirror daemon-published Entity storage records for local querying, reconnect, or offline read behavior.
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
A daemon-owned read model of current Mission system state used for bootstrapping and reconnecting clients.
_Avoid_: projection, full mission projection

**Daemon protocol version**:
The wire-compatibility version used by Airport surfaces and daemon clients to decide whether they can talk to the running Mission daemon.
_Avoid_: Mission runtime schema version, Entity schema version, workflow version

**Entity event**:
A fine-grained daemon notification that communicates a change to one Entity.
_Avoid_: projection update, partial projection

**Airport pane view**:
A daemon-derived view of one Airport pane for a surface to render.
_Avoid_: pane projection

**Mission control view**:
A daemon-derived operator view for one Mission that contains Mission Control outline and Mission Control selection.
_Avoid_: mission projection

**Mission control outline**:
The daemon-owned ordered Mission Control structure for one Mission, including stage rail and tree node references derived from workflow definition and Entity relationships.
_Avoid_: UI tree state, local tree derivation, mission projection tree

**Mission control outline node**:
A reference-first item in a Mission control outline that carries navigation metadata and an Entity id, not duplicated canonical Entity data.
_Avoid_: tree data object, projected entity, UI node model

**Mission control placement override**:
A durable Mission-scoped daemon-owned instruction that adds, orders, or roles one Entity reference in a Mission control outline when operator curation needs to differ from the default derived outline.
_Avoid_: UI reorder state, copied artifact, local tree mutation, operator preference

**Mission control selection**:
The surface-controlled, daemon-resolved operator focus for one Mission, such as active Mission stage, Mission task, Mission artifact, or Agent session.
_Avoid_: selected UI node, local selection heuristic, durable Mission coordination state

**Mission surface preference**:
An Airport surface/client-local affordance such as collapsed nodes, panel sizes, or temporary focus that does not change Mission runtime data, Entity storage records, Agent session context, or Mission control placement overrides.
_Avoid_: Mission control placement override, Mission control outline state, durable curation, daemon preference

**Derived workflow state**:
Workflow runtime state derived from Mission tasks, such as Mission stage state and gate state.
_Avoid_: workflow projection, stage projection

## Relationships

- The **Mission system** coordinates one or more **Missions**.
- A live **Mission** is executed by exactly one **Running Mission instance** in the daemon.
- A **Repository** may have one **GitHub repository ref**.
- A **Repository** has exactly one **Repository root**.
- **Repository control state** belongs to exactly one **Repository**.
- A **Repository** may define one **Mission workflow definition** used by its **Running Mission instances**.
- A **Mission** has exactly one **Mission branch ref**.
- A **Remote mission branch ref** corresponds to one **Mission branch ref** on a remote Git host.
- A **Mission worktree** is materialized from one **Mission branch ref**.
- A **Mission worktree** has exactly one **Mission worktree root**.
- A **Repository** uses a **Git adapter** for local Git operations at its **Repository root**.
- A **Repository** uses a **GitHub adapter** for hosted operations against its **GitHub repository ref**.
- A **Mission worktree** uses a **Git adapter** for local Git operations at its **Mission worktree root**.
- Hosted pull request and issue operations use the **GitHub adapter** against a **GitHub repository ref**.
- A **Mission** has exactly one **Mission dossier**.
- A **Mission dossier** contains **Mission runtime data** and the Mission runtime event log.
- A **Mission dossier state store** validates and checkpoints Mission runtime data changes for one **Mission dossier**.
- A filesystem adapter may read and write raw Mission dossier files, but it does not validate **Mission runtime data**.
- **Mission runtime data** has one **Mission runtime schema version**.
- A **Mission runtime schema version** applies to the whole persisted Mission runtime data, not separately to **Agent session context** or **Mission artifacts**.
- A **Mission runtime migration**, if introduced by an explicit future decision, belongs to the daemon persistence layer and must run outside ordinary State store hydration.
- A **Mission** has one or more **Mission stages**.
- A **Mission stage** status is derived from its **Mission tasks**.
- A **Mission artifact** may belong to a **Mission**, a **Mission stage**, or a **Mission task**.
- A **Mission-level artifact** belongs directly to one **Mission**.
- A **Stage-level artifact** belongs to one **Mission stage**.
- A **Task-level artifact** belongs to one **Mission task**.
- A **Mission task** belongs to exactly one **Mission stage**.
- An **Agent session** belongs to one **Mission** and may be focused on one **Mission task**.
- An **Agent session context** belongs to one **Agent session**.
- An **Agent session context** contains explicit **Mission artifact** references; it is not inferred from prompt text.
- An **Agent session context** owns the order of artifacts and instructions made available to its **Agent session**.
- **Mission control outline** placement may visualize or request changes to **Agent session context** ordering, but it is not the source of truth for that order.
- An **Agent session message** is accepted through the daemon, not by writing raw text directly into an Agent session terminal.
- **Agent runtime delivery** is best-effort and must not be treated as proof that an **Agent session** applied a context change.
- An **Agent session message** is not a first-class durable Entity unless the Mission system later needs queryable structured message history.
- An **Agent session log** records delivered Agent session interaction, while **Agent session context** records lasting context state.
- An **Agent session log** is daemon-owned audit material, not a **Mission artifact** by default.
- An **Agent-session artifact** may reference or extract from an **Agent session log** when the daemon or operator promotes useful material into Mission work.
- An **Agent runtime message** describes a structured message supported by an Agent session's Agent runtime.
- An **Agent runtime message descriptor** is the source of truth for which structured controls a surface may offer for an **Agent session**.
- An **Agent message shorthand** is not canonical; it parses into an **Agent session message** backed by an **Agent runtime message descriptor** or daemon-owned context operation.
- An **Agent message shorthand parser** belongs to the daemon; surfaces may offer autocomplete or previews but do not define canonical parse results.
- Base **Agent runtime messages** are common across Agent runtimes; Agent child runtimes may advertise additional supported messages.
- Daemon-owned context messages may update **Agent session context** before any optional delivery to an Agent runtime.
- A daemon-accepted **Agent session context** mutation is canonical even when related **Agent runtime delivery** fails, is ignored, or receives no structured response.
- Agent responses may be recorded as **Agent session log** observations, but they must not be used as authoritative context state unless modeled as separate daemon-validated state.
- **Terminal input** is reserved for direct CLI interaction and does not define canonical Agent session context.
- An **External agent prompt field** always submits an **Agent session message**; only focused terminal interaction sends **Terminal input**.
- An **Agent-session artifact** belongs to one **Agent session**.
- Raw **Agent session logs** do not appear in **Mission control outline** by default.
- A **Mission artifact** may be placed in the **Mission control outline** at Mission, stage, task, or Agent session level.
- An **Agent-session artifact** remains the same canonical **Mission artifact** when it becomes useful beyond its producing **Agent session**; the daemon may add another role or placement in the **Mission control outline** instead of copying it.
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
- The **Daemon in-memory datastore** is the first intended Mission state store adapter and keeps canonical working state inside the Mission daemon.
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
- An **Airport pane view** is derived from daemon-owned Airport state.
- A **Mission control view** is derived from Entity data, workflow definition, and runtime state for operator navigation.
- A **Mission control outline** is derived by default from Entity relationships, workflow definition, and runtime state.
- A **Mission control outline** may include **Mission control placement overrides** for operator-curated ordering or cross-placement roles.
- A **Mission control placement override** is durable Mission coordination state shared across surfaces and future operators.
- A **Mission control placement override** belongs to the daemon and does not change canonical Entity identity or duplicate Entity data.
- A **Mission surface preference** belongs to the Airport surface/client layer, not the daemon.
- A **Mission surface preference** must not encode durable outline placement or ordering.
- A **Mission control outline node** may carry view metadata such as kind, parent, depth, order, collapsibility, or role.
- A **Mission control outline node** should not duplicate canonical labels, lifecycle state, artifact paths, task status, or agent session details owned by Entities.
- A **Mission control selection** is controlled by one surface/operator session and resolved by the daemon against the Mission state store.
- A **Mission control selection** is not durable Mission coordination state and must not be shared as the current focus for every surface.
- A **Mission control outline** may show **Agent session context** artifacts under an **Agent session**, but **Agent session context** owns the ordered artifact references.
- A **Mission control outline** may show the same **Mission artifact** under multiple roles or placements when those placements express different relationships.
- Operator curation of Mission control ordering or cross-placement roles must mutate **Mission control placement overrides**, not surface-local tree state.
- Reordering or moving context artifacts through the **Mission control outline** must call daemon commands that mutate **Agent session context**.
- **Entity events** update client-side Entity instances; **Mission control view** updates operator outline and selection.
- **Derived workflow state** is recomputed from **Mission task** progress and is not independently edited.

## Architecture Boundaries

### Agent Session Context Synchronization

- The Mission daemon is the single source of truth for Agent session context and Mission artifact state.
- Airport surfaces and panes subscribe to daemon-driven updates and never own or persist Agent session context independently.
- Updates are daemon-published: the daemon notifies all surfaces of changes, ensuring multi-pane consistency.
- Surfaces may send selection or action hints, but the daemon resolves and rebroadcasts canonical state.

### Agent Session Context Ordering

- Agent session context ordering is durable Agent session state managed by the daemon.
- The order of artifacts and instructions in Agent session context is part of the Agent session's working context and audit trail.
- Mission control outline placement may visualize context order or request reorder commands, but it must not become the source of truth for Agent session context ordering.
- Reordering Agent session context must call daemon commands that mutate Agent session context.

### Agent Runtime Delivery

- Agent sessions are indeterministic and may ignore, misunderstand, or fail to structurally acknowledge delivered messages.
- Agent session context mutations become canonical when accepted by the daemon, not when acknowledged by the Agent runtime.
- Agent runtime delivery is optional, descriptor-defined, and best-effort.
- Mission must distinguish daemon-accepted context mutation, runtime delivery attempt, runtime output observation, and operator/system interpretation of that output.
- Agent runtime responses are observations in the Agent session log unless a future daemon-validated state model explicitly promotes them.

### Mission Control Outline Placement

- Mission control outlines are derived by default from Entity relationships, workflow definition, and runtime state.
- Explicit Mission control placement overrides are allowed only for daemon-owned operator curation, such as stable manual ordering or showing the same Mission artifact in another role.
- Mission control placement overrides are durable Mission coordination state shared by all surfaces and future operators.
- Surfaces may request outline placement changes, but they must not persist local outline structure independently.
- Placement overrides change outline placement only; they do not copy artifacts or mutate canonical Entity data.
- Mission surface preferences are local Airport surface/client state only.
- The daemon must not store Mission surface preferences.

### Mission Control Selection

- Mission control selection is surface-controlled and daemon-resolved.
- The daemon validates and normalizes requested selection against the Mission state store so surfaces do not invent invalid focus.
- Selection is not durable Mission coordination state; one operator's current focus must not change every other surface's current focus.
- Shared Mission navigation state belongs in Mission control placement overrides or canonical Entity relationships, not selection.

### Agent Session Context Lifecycle

- When an Agent session ends through completion, cancellation, or termination, the daemon updates session state and disposes runtime resources.
- Agent session logs are flushed and persisted as daemon-owned audit material; they are not deleted automatically and they are not Mission artifacts by default.
- Curated outputs derived from Agent session logs become Agent-session artifacts only through an explicit daemon or operator promotion action.
- Mission artifacts referenced by Agent session context are retained unless explicitly deleted by operator action or workflow.
- Surfaces update reactively; cleanup and retention logic is daemon-owned.

### Concurrent Agent Session Context Updates

- The Mission daemon serializes Agent session context and Mission artifact updates.
- Concurrent updates are resolved by last-write-wins; there is no explicit locking, merge strategy, or user-facing conflict resolution.
- Surfaces must reactively update to reflect the latest daemon state.

### Mission Workflow Runtime Schema Versioning

- Agent session context and Mission artifacts do not have independent persisted schema versions today.
- Persisted workflow runtime state is versioned by the **Mission runtime schema version** on the **Mission runtime data**.
- The daemon persistence layer rejects unsupported Mission runtime schema versions instead of allowing surfaces to interpret stale state.
- Future replacements of Mission runtime data layouts require explicit **Mission runtime migrations** or conversion commands; ordinary State store hydration rejects invalid data and does not repair it.
- Airport surfaces rely on Entity schemas, System snapshots, Entity events, and the **Daemon protocol version** for runtime compatibility; they do not run Mission runtime migrations.

### Mission State Store And Surface Replication

- The Mission state store is the canonical owner of Entity storage records, Mission runtime data, Agent session context, Mission control placement overrides, and other durable Mission coordination state.
- The current **Mission dossier state store** is a narrower per-Mission runtime module and must not be treated as the daemon-wide Mission state store.
- Mission state store schemas are written with Zod v4 and live in schema modules separate from state store adapter classes. Any shape that needs validation must have a Zod v4 schema as the source of truth, and exported TypeScript data types for validated shapes must be inferred with `z.infer` from those schemas. This keeps validation local to the Mission state store interface and prepares the same shapes for future SurrealDB database schema generation or mapping.
- The State store transaction is a small atomic write boundary for the Mission state store. Entity input commands, workflow commands, and daemon-owned domain intent are validated and applied through State store transactions before records change.
- State store transactions must stay simple: they group validation, storage writes, checkpointing, and change publication for one accepted write, but they do not introduce a separate event-sourcing model, replay model, or transaction-control architecture.
- Daemon modules must not write Entity storage records or durable Mission coordination state directly. SurrealDB is the storage engine behind the State store transaction interface, not a shared database client for arbitrary daemon modules.
- The first Mission state store adapter should be a Daemon in-memory datastore using embedded SurrealDB with SurrealMX-backed memory.
- The Daemon in-memory datastore is canonical working state, not a cache in front of another in-process model.
- The first State store persistence policy is Mission dossier-backed persistence: the daemon performs State store hydration once when starting or resuming a Mission, then live work reads and writes the Daemon in-memory datastore.
- Mission dossier checkpoints run after every accepted State store transaction because Mission data is currently small and direct persistence is simpler than batching. Mission must not treat the Mission dossier as a repeatedly-read live store during active daemon execution.
- If a Mission dossier checkpoint fails after a State store transaction was accepted, Mission does not roll back the accepted transaction. Agent sessions and Agent runtimes may already have changed files in the Mission worktree, and the Mission state store cannot emulate each agent runner's checkpoint or rollback semantics.
- A Mission checkpoint failure places the Mission in Mission recovery attention while keeping the Daemon in-memory datastore live so the daemon can retry, record diagnostics, or run recovery handling.
- Mission recovery attention is non-blocking: the daemon continues to accept new State store transactions while persistence recovery is pending, unless a separate future safety policy explicitly pauses a Mission.
- Mission recovery attention is daemon-only by default. Airport surfaces do not receive it through Mission control view, Mission control outline, System snapshot, or Entity data unless a future operator-facing recovery design explicitly promotes it.
- Batching, debouncing, or lifecycle-only checkpoints are future State store persistence policy optimizations and require a new decision before replacing direct checkpoints.
- SurrealDB capabilities remain available for live querying, indexing, relationships, change streams, and in-memory working state. Configured SurrealDB memory persistence, SurrealKV, RocksDB, or export/import may be added as recovery optimizations, but they must not replace the Mission dossier as the canonical durable recovery format without a new ADR.
- The daemon owns the State store persistence policy; surfaces and replicas must not define persistence for the Mission state store.
- Airport surfaces may maintain a Surface state replica for local querying, reconnect, or offline read behavior, but a replica must be populated from daemon-published Entity storage records and Entity change streams.
- Entity RPC methods remain the surface mutation interface: surfaces submit Entity input commands to the daemon, and the daemon validates and applies those commands through State store transactions before storage changes are checkpointed and published.
- A future offline surface may queue Entity input commands in an Entity command outbox, but replay must go through the daemon before changes become canonical.
- Surface state replicas replicate Entity storage records only. Entity data views are derived read surfaces and must not be treated as replicated source of truth.
- Replication cursors track delivery progress through Entity change streams; they do not replace Mission runtime schema versions, daemon protocol versions, or daemon-owned migrations.
- The datastore implementation may later add SurrealDB/WASM in a surface, but all datastore adapters must preserve daemon authority over the Mission state store.

## Example Dialogue

> **Dev:** "When the **Mission system** starts, should it resume every **Mission**?"
> **Domain expert:** "No. The **Mission system** may discover many **Missions**, but each **Mission** keeps its own execution state."

## Flagged Ambiguities

- "Mission" was used to mean both the product/system and a long-lived unit of work. Resolved: **Mission** means the unit of work; **Mission system** means the whole product/runtime.
- "Repository" can be confused with a checked-out mission worktree. Resolved: **Repository** means the base Git checkout, not a mission checkout.
- "Branch" was used to mean both a Git ref and a checked-out worktree. Resolved: names or refs use **Ref**; local checked-out Git work uses **Mission worktree**; filesystem locations use **Root** or **Path**.
- "Stage" can sound like a materialized folder or independently edited state. Resolved: **Mission stage** is derived from **Mission task** progress.
- Entity schemas used entity-specific id field names such as `repositoryId` or `missionId`. Resolved: an **Entity schema** uses a canonical `id` field for the Entity's identity.
- Entity behavior was described as if an outboard **Entity adapter** satisfied remote methods. Resolved: the **Entity class** is the behavior owner, while the **Entity contract** holds remote method metadata.
- "Projection" was used for old coarse-grained mission synchronization, Airport pane data, and workflow-derived state. Resolved: **Projection** is legacy/transition vocabulary; use **System snapshot**, **Entity event**, **Airport pane view**, **Mission control view**, or **Derived workflow state**.
- "Prompt" was used for both raw CLI input and structured operator intent. Resolved: use **Terminal input** for raw CLI bytes and **Agent session message** or **Agent runtime message** for structured daemon-mediated input.
- Agent session messages could be mistaken for a new durable Entity. Resolved: session logs record delivered interaction, and **Agent session context** records lasting context state; no separate message Entity is canonical yet.
- Agent runtime support was described with broad boolean capabilities. Resolved: use **Agent runtime message descriptors** to advertise supported structured messages and their input shapes.
- Slash commands can look like canonical commands. Resolved: slash commands are **Agent message shorthand** that parse into structured messages or context operations.
- `MissionState` can look like a concrete schema name. Resolved: **Mission state** is only an informal umbrella phrase; schema-facing code names the concrete **Mission runtime data** as `MissionRuntimeData`.
