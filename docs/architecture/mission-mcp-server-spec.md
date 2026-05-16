---
layout: default
title: Mission MCP Server Spec
parent: Architecture
nav_order: 8.5
description: Temporary working spec for realizing the daemon-owned open-mission-mcp server and Agent execution MCP signaling path.
---

## Temporary Mission MCP Server Spec

> Current authority: MCP is a structured input channel into the owning `AgentExecution` instance. `AgentExecution` owns process lifecycle and observation intake. `AgentExecutionRegistry` provides lookup and process-handle plumbing.

This is the MCP transport realization slice for the Agent execution structured interaction architecture described by ADR-0006.05 and ADR-0006.06.

It is temporary on purpose. It exists so implementation can proceed from one structural model instead of scattering MCP support through launch code, adapter code, Entity code, and daemon startup. The umbrella source of truth for descriptor shape, observation semantics, owner routing, and idempotency is [Agent Execution Structured Interaction Spec](agent-execution-structured-interaction-spec.md). This document must only specify the `open-mission-mcp` realization details under that umbrella. When the implementation converges, fold the durable parts into `CONTEXT.md`, accepted ADRs, and permanent architecture pages, then delete this file.

## Authoritative Inputs

- `CONTEXT.md`: canonical Mission language, especially Agent execution, Agent adapter, Mission MCP server, Entity, and Terminal terms.
- ADR-0001.03: Entity classes own behavior.
- ADR-0001.05: Entity commands are the canonical operator mutation surface.
- ADR-0006.04: stdout markers are the baseline Agent signal transport.
- ADR-0006.01: Agent execution and Agent adapter vocabulary.
- ADR-0006.05: Agent execution structured interaction vocabulary.
- ADR-0006.06: `open-mission-mcp` is the daemon-owned MCP signal transport.
- Agent Execution Structured Interaction Spec: controlling descriptor, observation, owner-routing, and signal vocabulary implementation reference.

## Greenfield Shape

This implementation is clean-sheet within the current architecture. It uses the current names, module paths, transport assumptions, and contracts in this spec.

The target shape is:

- One daemon MCP service name: `open-mission-mcp`.
- Current module names and import paths only.
- Canonical AgentExecution signal schemas reused by MCP and stdout-marker delivery.
- Workflow effects routed through AgentExecution observation handling and the owning Entity path.
- MCP provisioning resolved before launch when the selected delivery is `mcp-tool`.
- Runtime MCP state reflecting actual provisioning success.
- Helper code placed beside the owning behavior: AgentExecution, AgentAdapter, AgentExecutionRegistry, Terminal, or a named daemon runtime object.
- Non-MCP Agent runtimes using stdout-marker signal delivery when their protocol descriptor declares that delivery from the start.
- MCP-capable Agent runtimes using a stdio bridge process when the bridge is only a transport adapter to the daemon-owned `open-mission-mcp` service.
- Small pure functions living near the class that owns their behavior when they are private implementation details.

## Target Runtime Shape

```text
daemon startup
  -> AgentExecutionRegistry
  -> MissionMcpServer named open-mission-mcp
      -> session-scoped MCP access registry
      -> dynamic tool materialization from AgentExecution protocol descriptors

AgentExecution launch
  -> create AgentExecution id
  -> inspect AgentAdapter transport capabilities
  -> choose selected Agent signal delivery from Mission policy and launch mode
  -> create protocol descriptor with selected signal deliveries
  -> register MCP access when the selected delivery is mcp-tool
  -> ask AgentAdapter to materialize provider-specific MCP client config
  -> record small AgentExecution transport state
  -> launch provider runtime

Agent runtime MCP tool call
  -> open-mission-mcp tool ingress
  -> canonical Agent signal schema validation
  -> AgentExecutionRegistry route by Agent execution id
  -> AgentExecution transport-neutral observation entry point
  -> AgentExecution observation idempotency and policy
  -> owning Entity behavior
  -> AgentExecution state, Entity event, workflow event, or rejection
```

`open-mission-mcp` is daemon runtime infrastructure that exposes per-execution structured signal transport to Agent runtimes. Entity behavior, workflow behavior, repository access, and public automation semantics stay with their owning boundaries.

## Ownership Map

### AgentExecution Entity Boundary

AgentExecution owns the canonical protocol data and signal semantics:

- Agent signal payload schemas.
- Agent signal descriptor schemas.
- Agent execution protocol descriptor schema.
- Signal delivery vocabulary.
- Observation identity and idempotency rules.
- Generic AgentExecution observation policy.
- AgentExecution state transitions caused by accepted generic observation decisions.

Required schema changes:

```ts
type AgentSignalDelivery = 'stdout-marker' | 'mcp-tool';

type AgentSignalDescriptor = {
  type: string;
  label: string;
  description?: string;
  icon: string;
  tone: EntityPresentationTone;
  payloadSchemaKey: string;
  deliveries: AgentSignalDelivery[];
  policy: 'progress' | 'claim' | 'input-request' | 'audit-message' | 'diagnostic';
  outcomes: AgentSignalOutcome[];
};
```

Use `deliveries` as the schema field. This is a greenfield schema correction rather than a migration path.

AgentExecution must expose enough protocol data for both prompt instruction rendering and MCP tool materialization. MCP must read the same signal descriptors that stdout-marker instructions read.

AgentExecution also owns the observation idempotency invariant. Implement this as an Entity-bound value object or state component, for example `AgentExecutionObservationLedger`, inside `packages/core/src/entities/AgentExecution/`.

Ledger rules:

- The idempotency scope is one AgentExecution id.
- Agent signals require an Agent-supplied `eventId`.
- The same event id may create at most one accepted normalized observation for that AgentExecution.
- Duplicate event ids return replay-aware acknowledgement without repeating policy effects, Entity event publication, workflow effects, or AgentExecution state transitions.
- Duplicate acknowledgement reports replay handling.
- Provider and terminal observations without Agent event ids use explicit daemon-generated observation ids or deterministic dedupe keys according to their origin.

### MissionMcpServer

`MissionMcpServer` belongs under daemon runtime infrastructure, preferably:

```text
packages/core/src/daemon/runtime/agent/mcp/MissionMcpServer.ts
```

It owns MCP protocol ingress and the server lifecycle for the daemon-owned `open-mission-mcp` service.

Responsibilities:

- Start and stop with the daemon.
- Present the MCP server name `open-mission-mcp`.
- Register AgentExecution-scoped MCP access records.
- Materialize the dynamic tool set for one registered Agent execution from that execution's protocol descriptor.
- Validate MCP tool calls at ingress with canonical AgentExecution schemas.
- Convert valid tool calls into transport-neutral Agent execution observations.
- Return delivery acknowledgements.
- Reject unknown, unauthorized, mismatched, unsupported, oversized, duplicate, or stopped-session calls.

Related ownership stays outside `MissionMcpServer`:

- AgentExecution owns state transitions.
- Mission, Task, Repository, Artifact, and workflow modules own their behavior.
- Entity command dispatch stays with Entity command infrastructure.
- AgentAdapters own adapter-specific MCP config file syntax.
- Terminal owns terminal IO.

`MissionMcpServer` may contain private collaborator classes when each has a named responsibility and stays inside the MCP daemon runtime boundary:

- `MissionMcpSessionRegistry`: stores registered MCP access records for active Agent executions.
- `MissionMcpToolCatalog`: materializes MCP tool descriptors from AgentExecution protocol descriptors.
- `MissionMcpToolCall`: validates one inbound call and normalizes it to an Agent signal input.

Helper modules are named for the behavior owner. AgentExecution schema behavior lives in the AgentExecution boundary, adapter config translation lives in the AgentAdapter boundary, and daemon startup behavior stays in daemon composition.

### AgentExecutionRegistry

AgentExecutionRegistry is daemon-internal lookup and process-handle plumbing for active AgentExecution instances. `open-mission-mcp` must route through it instead of keeping its own execution map with domain meaning.

Add a narrow routing method to AgentExecutionRegistry, such as:

```ts
routeTransportObservation(input: AgentExecutionTransportObservationInput): AgentExecutionTransportObservationAck;
```

The exact names can change, but the method must:

- Require an AgentExecution id.
- Resolve the active registry entry.
- Reject final or missing executions.
- Delegate policy and state effects through the registered AgentExecution-owned observation path.
- Return a schema-backed acknowledgement.

AgentExecutionRegistry may also publish MCP access state in AgentExecution data when Open Mission needs it. MCP protocol serving, adapter-specific config writing, lifecycle coordination, and session control stay with their owning components.

### AgentExecution Launch And Observation Path

AgentExecution owns the launch and observation path for one started Agent execution:

- Ask the selected AgentAdapter for transport capabilities before launch.
- Choose the selected Agent signal delivery from adapter capability, Mission policy, launch mode, and process constraints.
- Create the AgentExecution protocol descriptor with the selected signal delivery.
- Register MCP access with `MissionMcpServer` before provider launch when the selected delivery is `mcp-tool`.
- Pass ephemeral MCP access material to the AgentAdapter launch preparation path when MCP is selected.
- Record selected transport state.
- Expose one transport-neutral observation entry point used by stdout parsing, provider output, terminal diagnostics, and MCP tool calls.
- Dispose registered MCP access during execution cleanup.

Private launch helpers coordinate launch mechanics. MCP tool schemas come from AgentExecution descriptors, provider-specific MCP config files come from AgentAdapter preparation, idempotency stays with AgentExecution, and owner Entity workflow state changes through owner behavior.

### AgentAdapter

AgentAdapter owns provider-specific translation. MCP client provisioning for Claude Code, Copilot CLI, OpenCode, Codex, Pi, or future adapters belongs here or in adapter-owned strategy objects.

Separate provider capability from launch selection. The adapter advertises what the provider can support; AgentExecution chooses what this execution will use and records the selected delivery in AgentExecution transport state.

Suggested adapter capability shape:

```ts
type AgentSignalDelivery = 'stdout-marker' | 'mcp-tool';

type AgentAdapterTransportCapabilities = {
  supported: AgentSignalDelivery[];
  preferred?: AgentSignalDelivery;
  provisioning: {
    requiresRuntimeConfig: boolean;
    supportsStdioBridge: boolean;
    supportsDynamicTools: boolean;
  };
};

type AgentExecutionTransportState = {
  selected: AgentSignalDelivery;
  degraded: false;
};
```

`supported` answers provider capability, for example whether Claude Code can use MCP at all. `AgentExecutionTransportState.selected` answers the launch contract for this execution, for example whether a simple print-mode launch intentionally selected `stdout-marker` even though the provider supports MCP.

For this greenfield realization, model provider capability and selected execution delivery separately. A single adapter field such as `mcp-required`, `mcp-optional`, or `stdout-marker-only` mixes provider capability with Mission launch policy.

Adapter launch preparation receives an ephemeral MCP access object only when `AgentExecutionTransportState.selected` is `mcp-tool`. That object may include:

- server name: `open-mission-mcp`
- bridge command or local endpoint
- AgentExecution id
- session capability token
- dynamic tool descriptors
- config cleanup callback

Tokens and per-execution config live in ephemeral daemon or adapter-owned runtime material. Durable AgentExecution data stays secret-free. Static project config may refer to `open-mission-mcp` only through environment-variable placeholders or adapter-owned untracked runtime files.

If the selected delivery is `mcp-tool` and MCP provisioning fails, the launch fails. The daemon may create a new execution attempt that selects `stdout-marker` only when Mission policy and operator intent permit that before launch. Active executions keep the delivery selected in their launch contract.

### Daemon Startup

`startOpenMissionDaemon` is the daemon composition root for this feature.

Startup sequence target:

1. Create logger.
2. Create MissionRegistry.
3. Create AgentExecutionRegistry.
4. Create MissionMcpServer with AgentExecutionRegistry and logger.
5. Start MissionMcpServer.
6. Start daemon IPC server and existing Entity event sources.
7. Hydrate daemon Missions.
8. On shutdown, stop MissionMcpServer before disposing AgentExecutionRegistry.

If startup fails after MissionMcpServer starts, shutdown must dispose it. This is normal daemon lifecycle cleanup, not a fallback path.

### CLI Stdio Bridge

Some MCP clients prefer or require a stdio server process. Mission may add a CLI command that acts as a stdio bridge to the daemon-owned `open-mission-mcp` service.

Suggested command shape:

```text
mission mcp connect --agent-execution <id>
```

This command is an adapter between a stdio MCP client and the daemon-owned `open-mission-mcp` service. If the daemon is stopped, the bridge fails. Mission state, workflow parsing, and AgentExecution registry ownership stay in the daemon.

## Protocol Descriptor Realization

The protocol descriptor defined by Agent Execution Structured Interaction Spec is the single source for both transports. The shape is restated here only to show the MCP fields that `open-mission-mcp` consumes; changes to descriptor shape happen in the umbrella spec first.

Suggested shape:

```ts
type AgentExecutionProtocolDescriptor = {
  version: 1;
  owner: AgentExecutionProtocolOwner;
  scope: AgentExecutionScope;
  messages: AgentExecutionMessageDescriptor[];
  signals: AgentSignalDescriptor[];
  mcp?: {
    serverName: 'open-mission-mcp';
    exposure: 'session-scoped';
    publicApi: false;
  };
};
```

The `mcp` field is descriptor metadata, not a place to store secrets or live endpoint data. Ephemeral endpoint and token material belongs to launch preparation and daemon runtime access records.

Signal descriptors decide whether a signal can be delivered by `stdout-marker`, `mcp-tool`, or both. MCP uses the same signal payload schemas as every other delivery path.

## MCP Tool Shape

The first implementation should expose one tool per descriptor-supported signal type for readability:

```text
progress
needs_input
blocked
ready_for_verification
completed_claim
failed_claim
message
```

Each tool call must carry or be bound to:

- AgentExecution id
- event id
- signal payload fields
- session capability token or equivalent daemon-issued authorization

The tool catalog is dynamic per AgentExecution. A tool exists only when that execution's protocol descriptor includes the matching signal descriptor with `mcp-tool` delivery.

Tool names are provisioned transport affordances rather than stable public API. If descriptor growth causes tool explosion, replace the presentation with a descriptor-backed `emit_signal` tool in one clean change.

## Observation Acknowledgement

Define a schema-backed acknowledgement in the AgentExecution boundary or MCP runtime boundary. Suggested shape:

```ts
type AgentExecutionObservationAck = {
  status: 'accepted' | 'duplicate' | 'rejected' | 'recorded-only' | 'promoted';
  agentExecutionId: string;
  eventId: string;
  observationId?: string;
  reason?: string;
};
```

Acknowledgements are delivery feedback only. They are not verification success, task completion, workflow approval, or proof that an indeterministic Agent understood anything.

## Implementation Sequence

### 1. Update AgentExecution Protocol Schemas

- Replace `AgentSignalDeliverySchema = z.enum(['stdout-marker'])` with `z.enum(['stdout-marker', 'mcp-tool'])`.
- Replace singular `delivery` with `deliveries` in `AgentSignalDescriptorSchema`.
- Update baseline descriptors to use `deliveries`.
- Add descriptor metadata for `open-mission-mcp` when any signal supports `mcp-tool`.
- Update tests without keeping old field aliases.
- Keep this step in lockstep with Agent Execution Structured Interaction Spec. MCP consumes the AgentExecution descriptor shape directly.

### 2. Add AgentExecution Observation Idempotency

- Add an AgentExecution-owned observation ledger.
- Require Agent signal event ids for both stdout-marker and MCP delivery.
- Make duplicate event ids return duplicate acknowledgements without policy effects.
- Keep observation history append-only from the domain perspective.

### 3. Add MissionMcpServer

- Create `MissionMcpServer` under daemon runtime agent MCP ownership.
- Start and stop it from daemon startup/shutdown.
- Register per-execution MCP access records.
- Materialize tool catalogs from descriptors.
- Convert tool calls into transport-neutral Agent execution observations.

### 4. Add Registry And Executor Routing

- Add AgentExecutionRegistry routing for transport observations.
- Add AgentExecution transport-neutral observation entry point.
- Reuse the same policy and owner-routing path for stdout, provider, terminal, and MCP observations.
- Remove any duplicated MCP-specific policy branch.

### 5. Add Adapter MCP Provisioning

- Add adapter transport capability metadata.
- Add small AgentExecution transport state that records the selected delivery.
- Add adapter-owned MCP client config materialization.
- Pass ephemeral MCP access data into launch preparation.
- Fail launch when the selected delivery is `mcp-tool` and MCP cannot be provisioned.
- Use stdout-marker delivery only when the execution selected stdout markers before launch.

### 6. Add Optional CLI Bridge

- Add a `open-mission mcp connect` bridge only if needed by the first supported adapter.
- The bridge connects to the daemon-owned `open-mission-mcp` service.
- The bridge does not own schemas, policy, Entity state, or workflow behavior.

### 7. Remove Conflicts

- Remove obsolete server-name references if any appear.
- Remove singular `delivery` descriptor usage.
- Remove MCP schema copies.
- Remove compatibility aliases and fallback provisioning branches.
- Remove any MCP handler that applies workflow changes directly.

## Validation Plan

Minimum tests:

- AgentExecution signal descriptor schema accepts `deliveries` with `stdout-marker` and `mcp-tool`.
- Old singular `delivery` is rejected.
- Protocol descriptor exposes `open-mission-mcp` metadata only when MCP delivery is present.
- MissionMcpServer starts and stops with daemon lifecycle.
- MissionMcpServer registers per-execution access and materializes only descriptor-allowed tools.
- MCP tool calls validate against canonical Agent signal payload schemas.
- MCP tool calls route to the same observation policy path as stdout markers.
- Duplicate event ids return replay-aware acknowledgements without repeating policy, Entity event, workflow, or AgentExecution state effects.
- Unknown execution, final execution, wrong token, unsupported tool, invalid payload, and oversized payload calls are rejected.
- Adapter capability tests distinguish supported transports, preferred transport, and provisioning features.
- Selected-delivery tests show MCP-capable adapters can still select stdout markers for launch modes or runtime constraints that require them.
- Adapter provisioning fails launch when the selected delivery is `mcp-tool` and MCP access cannot be created.
- Stdout-marker executions launch with stdout-marker descriptors and no MCP access record.

Run at minimum:

```bash
pnpm --filter @flying-pillow/open-mission-core check
pnpm --filter @flying-pillow/open-mission-core test
pnpm --filter @flying-pillow/open-mission-core build
pnpm --filter @flying-pillow/open-mission check
pnpm --filter @flying-pillow/open-mission build
```

## Constitutionality Checklist

- Clear owner: AgentExecution owns signal schemas, descriptors, observations, idempotency, and launch coordination; MissionMcpServer owns MCP ingress; AgentAdapter owns provider config translation; AgentExecutionRegistry owns active lookup and process-handle plumbing.
- DRY: MCP uses AgentExecution signal schemas and descriptors directly.
- OOD: behavior lives in named Entity, adapter, registry, or daemon runtime classes.
- Contract-first: tool calls, descriptors, access records, and acknowledgements are schema-backed.
- Repo-native: no per-execution secrets in tracked files.
- Provider-neutral: Mission core does not import provider-specific MCP config assumptions.
- Greenfield: no aliases, compatibility exports, or fallback provisioning branches.
- Deterministic: tests cover schema, lifecycle, routing, idempotency, and launch failure behavior.
