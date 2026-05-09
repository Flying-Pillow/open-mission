---
layout: default
title: Agent Execution Structured Interaction Spec
parent: Architecture
nav_order: 8
description: Temporary working spec for owner-addressed Agent execution messages, signals, observations, descriptors, and Entity events.
---

## Temporary Agent Execution Structured Interaction Spec

This is the umbrella working implementation spec for the Agent execution structured interaction architecture described by ADR-0022 and extended by ADR-0024.

It is temporary on purpose. It exists so future implementation sessions can continue from the same clean-sheet model. When the implementation converges, fold the durable parts into `CONTEXT.md`, accepted ADRs, and permanent architecture pages, then delete this file.

## Reflection

The task is to implement a clear architecture for how an Agent execution communicates with Mission through the Entity that owns its scope. The current `@mission::` marker path is useful source material for parser behavior, validation, and tests.

The current code is useful evidence. It has parsers, policy checks, terminal observation, runtime messages, AgentExecution snapshots, and workflow integration. It is not authoritative where it conflicts with ADR-0022 or the OOD Entity model. Any current module that keeps AgentExecutor as the semantic owner of Task, Mission, Repository, or Artifact meaning is implementation material to reshape, not architecture to preserve.

The desired architecture is an Entity-addressed runtime conversation:

```text
AgentExecutionScope
  -> owning Entity
      -> Agent execution protocol descriptor
      -> owner-addressed Agent-declared signals
      -> owner-owned observation handling
      -> AgentExecution state changes and Entity events
```

The implementation must make the available structured interaction inspectable before launch, materialize the declared signal transports from that inspected contract, parse or receive Agent-declared signals against that same contract, and route accepted observations through the owning Entity path.

## Authoritative Inputs

- `CONTEXT.md`: canonical Mission language.
- ADR-0012: Entity classes own behavior.
- ADR-0015: Entity commands are the canonical operator mutation surface.
- ADR-0017: prompt-scoped Agent execution signals are the current transport baseline.
- ADR-0018: Agent, AgentAdapter, AgentExecutor, AgentExecution, and Terminal vocabulary.
- ADR-0022: structured Agent execution interaction vocabulary and owner-addressed signal model.
- ADR-0024: `mission-mcp` is the daemon-owned MCP signal transport for Agent-declared signals.
- Mission MCP Server Spec: subordinate realization blueprint for the MCP transport. It must not redefine descriptor, observation, owner-routing, or idempotency semantics independently of this spec.

## Vocabulary To Implement

### Agent Execution Protocol Descriptor

The Agent execution protocol descriptor is the source of truth for one execution's structured interaction contract.

It combines:

- Agent execution message descriptors: daemon/operator-to-AgentExecution input.
- Agent-declared signal descriptors: Agent-to-owner structured signal payloads and their declared delivery transports.
- Owner addressing metadata: marker prefix, owning Entity name, owning Entity id, and scope identifiers.
- Policy metadata: which outcomes each accepted signal may produce.
- Transport metadata: whether this execution exposes stdout-marker delivery, `mission-mcp` delivery, or both.

### Agent Execution Message

An Agent execution message is structured input sent by the daemon or operator to an AgentExecution. It may be delivered to a terminal-backed adapter as prompt text, but the message itself is structured daemon intent.

Message examples:

- prompt the Agent execution
- interrupt or resume the Agent execution
- request a checkpoint
- attach, remove, or reorder Agent execution context
- answer an Agent `needs_input` observation

### Agent-Declared Signal

An Agent-declared signal is structured Agent-authored input to the owning Entity path. It may arrive as a stdout marker or as a `mission-mcp` tool call. The signal payload shape is the same regardless of transport.

For stdout-marker delivery, the marker prefix is derived from the owning Entity, not from the transport or adapter.

Target marker prefixes:

- `@task::` for task-scoped Agent executions
- `@mission::` for mission-scoped Agent executions
- `@repository::` for repository-scoped Agent executions
- `@artifact::` for artifact-scoped Agent executions
- `@system::` for system-scoped Agent executions

The stdout marker payload is strict JSON. The MCP tool payload is schema-validated structured input. The descriptor defines the accepted payload shapes and delivery transports for that execution.

### Mission MCP Server

The Mission MCP server is the daemon-owned local MCP service named `mission-mcp`. It materializes session-scoped tools from the Agent execution protocol descriptor and converts accepted MCP tool calls into Agent execution observations. It is a transport adapter into the same observation path as stdout markers, not an Entity, workflow owner, repository API, public automation API, or separate Agent execution model.

### Agent Execution Observation

An Agent execution observation is the daemon-normalized form of runtime output or structured Agent-authored transport input. Observations come from parsed Agent-declared stdout markers, `mission-mcp` tool calls, provider-structured output, terminal diagnostics, or daemon-authored runtime facts.

Observation handling belongs to the owning Entity path. AgentExecutor can observe and route. The owning Entity decides scoped meaning.

Agent execution observations are append-only and idempotent. An Agent-declared signal event id may produce policy effects at most once for one AgentExecution, regardless of whether it arrived through stdout-marker delivery, `mission-mcp`, adapter replay, or a transport retry.

### Agent Execution Claim

An Agent execution claim is an accepted observation where the Agent declares a state assertion such as ready-for-verification, completed, failed, blocked, or needing input. Claims update AgentExecution audit/progress state and may publish Entity events. Mission task completion follows owner workflow rules.

### Entity Event

An Entity event is an accepted daemon-published fact. Agent stdout becomes an Entity event only after parsing, policy evaluation, owner handling, and event publication.

## Target Ownership

## Scan Findings From The First Implementation Pass

The first implementation pass exposed three architecture smells that must not be carried forward:

- Marker prefixes were duplicated in daemon runtime code even though `AgentExecutionOwnerMarkerPrefixSchema` already owns the enum.
- Runtime signal modules introduced terms such as `protocol-marker`, parser defaults, and signal decisions that were not part of ADR-0022 vocabulary.
- The daemon `signals` folder mixed transport observation, payload parsing, policy evaluation, prompt rendering, and semantic state mutation in a way that obscured which behavior belongs to AgentExecution and which belongs to the owning Entity.

Correction rule: the daemon may normalize output into observations, but it must not define owner prefixes, default an owner prefix, or become the semantic owner of scoped Mission, Task, Repository, or Artifact meaning.

Current consolidation outcome:

- Agent-declared marker payload schemas and limits live in the AgentExecution Entity schema boundary.
- AgentExecution signal, observation, and decision types live in the AgentExecution protocol boundary, not in daemon runtime.
- AgentExecution owns generic observation policy for session-safe promotion, duplicate rejection, lifecycle boundaries, and route/address validation.
- Daemon runtime signal files are limited to launch instruction rendering and observation routing/normalization.
- Standalone parser/normalizer files that only restated runtime details were removed.

Runtime-local helper terms are allowed only when they describe daemon mechanics. Keep them small:

- `observation`: daemon-normalized runtime output.
- `origin`: the runtime boundary that produced the observation.
- `diagnostic`: non-authoritative runtime evidence.

Avoid promoting helper words such as `candidate`, `decision`, `marker`, or `policy` into architecture vocabulary unless an ADR defines them. If they remain in implementation code, they are implementation details and should stay close to the code that uses them.

### AgentExecution Entity

AgentExecution owns:

- execution identity
- explicit AgentExecutionScope
- durable Agent execution context
- protocol descriptor snapshot
- message descriptors
- signal descriptors
- signal delivery declarations
- observation identity and idempotency
- generic observation promotion policy for AgentExecution state
- progress and attention state
- terminal handle references
- audit-facing AgentExecution events

### Owning Entity

The owning Entity is resolved from AgentExecutionScope:

| Scope kind | Owning Entity |
| --- | --- |
| `system` | System-level daemon owner, later formalized as an Entity if needed |
| `repository` | Repository |
| `mission` | Mission |
| `task` | Task, with Running Mission aggregate as workflow delegate |
| `artifact` | Artifact, with optional Mission or Task context from scope data |

The owning Entity owns:

- descriptor contribution for scope-specific signals
- owner-addressed marker prefix
- observation handling policy for scoped meaning
- mapping accepted observations to Entity events, AgentExecution updates, and workflow events
- context operations that require owner knowledge of artifacts, tasks, repositories, or missions

### AgentExecutor

AgentExecutor owns:

- resolving Agent and AgentAdapter
- selecting the Agent-declared signal delivery for the execution
- process launch and reconcile coordination
- terminal attachment
- provider output parsing
- stdout/stderr observation capture
- `mission-mcp` access registration coordination
- routing observations to the owner path
- delivery attempts for Agent execution messages

AgentExecutor uses owner-Entity resolution and AgentAdapter transport capabilities to choose the selected Agent-declared signal delivery before launch. It renders prompt-scoped instructions when the selected delivery is `stdout-marker`, registers MCP access when the selected delivery is `mcp-tool`, records the small AgentExecution transport state, and routes transport-neutral observations back through the same owner path.

### AgentAdapter

AgentAdapter owns provider translation only:

- adapter metadata validation
- provider transport capability declaration
- launch command, args, env, and optional preparation
- provider-structured output parsing into observations
- provider-specific delivery mechanics when the adapter supports structured delivery
- provider-specific MCP client configuration when the selected delivery is `mcp-tool`

AgentAdapter capability, selected AgentExecution delivery, and provisioning result are separate facts. The adapter can support MCP while an execution selects stdout markers because of launch mode, Mission policy, detached runtime, remote execution, or loopback constraints. If the selected delivery is `mcp-tool` and provisioning fails, the launch fails; the daemon must not silently degrade that active execution into stdout markers.

### Terminal And TerminalRegistry

Terminal and TerminalRegistry remain the PTY authority:

- process lease
- screen state
- input and resize
- exit state
- terminal snapshots and recording updates

Terminal output is runtime material. Structured Agent communication starts when owner-addressed signal parsing accepts a line as a signal candidate.

## Protocol Descriptor Shape

The implementation should introduce a schema-backed descriptor close to the AgentExecution Entity module.

Suggested shape:

```ts
type AgentExecutionProtocolDescriptor = {
  version: 1;
  owner: {
    entity: 'Task' | 'Mission' | 'Repository' | 'Artifact' | 'System';
    entityId: string;
    markerPrefix: '@task::' | '@mission::' | '@repository::' | '@artifact::' | '@system::';
  };
  scope: AgentExecutionScope;
  messages: AgentExecutionMessageDescriptor[];
  signals: AgentDeclaredSignalDescriptor[];
  mcp?: {
    serverName: 'mission-mcp';
    exposure: 'session-scoped';
    publicApi: false;
  };
};
```

Suggested signal descriptor shape:

```ts
type AgentDeclaredSignalDescriptor = {
  type: string;
  label: string;
  payloadSchemaKey: string;
  deliveries: Array<'stdout-marker' | 'mcp-tool'>;
  policy: 'progress' | 'claim' | 'input-request' | 'audit-message' | 'diagnostic';
  outcomes: Array<'agent-execution-event' | 'agent-execution-state' | 'owner-entity-event' | 'workflow-event'>;
};
```

The exact TypeScript names can change during implementation. The source of truth must be Zod schemas with inferred types. Use `deliveries`; do not retain the old singular `delivery` field as an alias.

`mcp` descriptor metadata is not a place to store secrets, local endpoint data, or live session tokens. Those belong to daemon runtime access records and adapter launch preparation.

## Baseline Signals

Every owner can contribute a different signal set, but the first clean implementation should support these shared Agent-declared signals:

- `progress`: update AgentExecution progress after owner policy acceptance.
- `needs_input`: keep AgentExecution lifecycle `running`, set attention to `awaiting-operator`, attach the current input-request id, and publish an owner-visible event when useful. Payload must include `question` and `choices`, where each choice is either a fixed label/value choice or a manual freeform-input choice with label and optional placeholder.
- `blocked`: update AgentExecution progress/attention and publish an owner-visible event when useful.
- `ready_for_verification`: create a verification claim for owner/operator handling.
- `completed_claim`: create a completion claim for owner/operator handling.
- `failed_claim`: create a failure claim for owner/operator handling.
- `message`: append an audit-facing AgentExecution message event.

Task scope can map `ready_for_verification` to verification workflow affordances. Task scope can map daemon-authoritative lifecycle events to Task completion through the Running Mission aggregate. Agent-authored completion claims remain claims until owner workflow behavior accepts a transition.

## Implementation Sequence

### 1. Stabilize Descriptors

Create schema-backed protocol descriptor types in the AgentExecution Entity module.

Add signal descriptor schemas beside or near existing message descriptors. Prefer one AgentExecution-owned protocol schema module if `AgentExecutionSchema.ts` becomes too broad.

Replace singular `delivery` with `deliveries: Array<'stdout-marker' | 'mcp-tool'>`. Remove all singular field usage in the same change. This is greenfield cleanup, not a compatibility migration.

Expose the protocol descriptor in AgentExecution data or a protocol snapshot query so launch code, Airport, tests, and prompt rendering read the same descriptor.

### 2. Resolve Owning Entity From Scope

Introduce owner-Entity resolution from AgentExecutionScope in daemon/core code.

Resolution returns owner metadata and owner behavior used by daemon internals:

- owner Entity name
- owner Entity id
- marker prefix
- descriptor contribution
- observation handling method

This can be implemented with TypeScript interfaces internally, but the architecture vocabulary remains owner-Entity resolution and Entity behavior.

### 3. Render Instructions From Descriptor

Replace hand-written signal payload lists in launch prompt construction with descriptor-rendered instructions for executions that declare stdout-marker delivery.

The rendered instructions include:

- marker prefix
- owner Entity kind resolved from AgentExecutionScope
- execution id
- required AgentExecution identity field
- supported signal payloads from descriptors
- examples generated from descriptors

For executions that declare `mcp-tool` delivery, `mission-mcp` materializes tools from the same signal descriptors. MCP tool names are execution-scoped transport affordances, not stable public APIs.

### 4. Parse Owner-Addressed Signals

Replace the single Mission protocol parser with owner-addressed Agent-declared signal parsing.

Parsing accepts the prefix from the descriptor for the active execution. It parses strict JSON, validates payload shape through the signal descriptor, preserves event id / observation id data, and returns Agent execution observations.

Do not create a runtime default prefix. A missing descriptor prefix is a launch/routing error, not a parser choice.

The current parser and tests are useful source material, but the new parsing path should be descriptor-driven and should not duplicate marker-prefix literals owned by the AgentExecution schema.

### 4a. Materialize Mission MCP Tools

Use the Mission MCP Server Spec for concrete MCP realization. Architecturally, `mission-mcp` must:

- start and stop with the daemon
- register access for active Agent executions that declare `mcp-tool` delivery
- materialize tools dynamically from the AgentExecution protocol descriptor
- validate tool payloads with canonical AgentExecution signal schemas
- route accepted calls into the same transport-neutral observation path as stdout markers
- return acknowledgement status without claiming workflow completion

It must not duplicate signal schemas, apply workflow state directly, or maintain a second execution model.

### 5. Route Observations Through Owner Entity

Change AgentExecutor observation application so it routes observations from every declared transport to the owning Entity path.

The owner path evaluates observation policy, updates AgentExecution state through accepted owner behavior, publishes Entity events, and emits workflow events through the Running Mission aggregate when scope rules require it.

Apply AgentExecution-owned idempotency before policy effects. Duplicate Agent-declared event ids must not repeat AgentExecution state changes, owner Entity events, or workflow effects.

### 6. Update Runtime Messages

Clarify Agent execution messages as daemon/operator-to-AgentExecution input.

Move context-changing messages behind daemon-accepted AgentExecution context operations. Adapter delivery remains best effort and audit material.

### 7. Remove Conflicting Runtime Paths

After the owner-routed descriptor path works, remove or rewrite current code that keeps these responsibilities outside the target owners:

- hard-coded `@mission::` launch instruction generation as the universal signal source
- signal payload lists duplicated outside descriptors
- AgentExecutor direct semantic application of scoped observations
- Mission/task assumptions baked into AgentExecution identity where AgentExecutionScope should carry the owner context
- runtime message descriptors stored as data without a matching signal descriptor source of truth
- standalone runtime files that only restate schema, prefix, or descriptor facts already owned by AgentExecution
- singular `delivery` descriptor fields
- MCP-local signal payload schemas
- MCP provisioning branches that silently degrade an MCP-declared launch into stdout markers

## Tests And Validation

Minimum test coverage:

- descriptor schema validation for message and signal descriptors
- descriptor schema rejects singular `delivery` and accepts `deliveries`
- owner prefix derivation for task, mission, repository, and artifact scopes
- prompt instructions generated from descriptors
- `mission-mcp` tools generated from the same descriptors
- parser accepts only the active execution's owner prefix and descriptor payloads
- parser rejects malformed, oversized, wrong-execution, duplicate, and unsupported markers
- MCP tool calls reject malformed, oversized, wrong-execution, duplicate, unauthorized, and unsupported inputs
- AgentExecutor routes stdout-marker and MCP observations to owner handling rather than applying scoped meaning directly
- Task-owned ready/completion/failure claims remain claims until owner workflow behavior accepts lifecycle changes
- Airport reads message and signal descriptors from the same protocol source used for launch instructions

Run at minimum:

```bash
pnpm --filter @flying-pillow/mission-core check
pnpm --filter @flying-pillow/mission-core test
pnpm --filter @flying-pillow/mission-core build
pnpm --filter @flying-pillow/mission-airport-web check
pnpm --filter @flying-pillow/mission-airport-web build
```

## Open Design Questions

1. Should artifact-scoped execution always use `@artifact::`, or should task-owned artifact work use `@task::` when `taskId` is present?
2. Should owner observation handling be a daemon-internal Entity method first, then promoted to Entity contract only when a client-facing need appears?
3. Should AgentExecution publish separate events for `progress.changed`, `claim.created`, and `input.requested`, or keep only `data.changed` until Airport needs more specific event channels?
4. Should `@system::` be implemented now, or postponed until a System Entity contract exists?

## Working Implementation Rule

Prefer deleting conflicting old paths over wrapping them. If the current implementation duplicates descriptor truth, owner routing, or signal payload definitions, converge it into the new owner-addressed protocol model in the same bounded change.
