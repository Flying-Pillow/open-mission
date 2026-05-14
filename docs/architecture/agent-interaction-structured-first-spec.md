---
layout: default
title: Agent Interaction Structured-First Spec
parent: Architecture
nav_order: 8.91
description: Temporary implementation spec for structured-first Agent interaction, slash command taxonomy, and terminal-capable execution postures.
---

## Temporary Agent Interaction Structured-First Spec

This temporary SPEC describes the implementation direction for ADR-0006.10 and the Agent Interaction Structured-First PRD. It is intentionally provisional. When the model stabilizes, fold the durable parts into permanent architecture docs and remove this file.

## Authoritative Inputs

- `CONTEXT.md`: canonical Mission vocabulary.
- ADR-0006.03: runtime-defined Agent execution messages.
- ADR-0001.05: Entity commands as canonical operator surface.
- ADR-0006.01: Agent, AgentAdapter, AgentExecutor, AgentExecution, and Terminal vocabulary.
- ADR-0006.06: Mission MCP server Agent signal transport.
- ADR-0006.08 and ADR-0006.13: AgentExecution interaction journal and typed journal ledger.
- ADR-0006.09: Agent execution semantic operations.
- ADR-0006.10: structured-first Agent interaction with terminal capability.

## Target Model

Mission implements a structured-first AgentExecution interaction model with optional terminal capability.

```text
Open Mission Mission UI
  -> Entity commands / AgentExecution messages / semantic operation requests
  -> AgentExecution protocol descriptor
  -> AgentExecutor delivery and runtime coordination
  -> AgentAdapter transport translation
  -> Agent runtime
  -> MCP tools / stdout markers / provider events / terminal evidence
  -> AgentExecution observation routing
  -> AgentExecution journal and owner Entity effects
```

The Terminal lane is attached to the AgentExecution runtime graph but is not the canonical command model.

## Execution Postures

### Structured Interactive

Structured interactive execution has both a structured Mission control lane and an attached Terminal.

Use for:

- developer-led work with Claude Code, Copilot CLI, Codex, or another terminal-capable adapter.
- workflows where native provider UX is still valuable.
- migrations where Mission UI does not yet expose all desired actions.

Requirements:

- AgentExecution snapshot declares terminal attachment and selected structured signal transport.
- Mission UI prompt box sends AgentExecution messages, not raw terminal input.
- Raw terminal pane remains available as an explicit native lane.
- Semantic observations come from MCP, stdout markers, provider parsers, or daemon-normalized facts.

### Structured Headless

Structured headless execution has no operator-facing terminal dependency.

Use for:

- unattended routines.
- connection tests and smoke probes where no managed AgentExecution is created.
- verification tasks.
- batch or background execution.
- future Mission-chat-first workflows.

Requirements:

- AgentExecution snapshot declares no operator terminal dependency.
- Agent progress and operator-facing responses arrive through structured signals, provider parsers, or runtime facts.
- Mission UI can show useful progress without terminal scrollback.

### Native Terminal Escape Hatch

Native terminal escape hatch allows direct terminal input for provider-native interaction.

Use for:

- provider-specific slash commands Mission has not normalized.
- login/debug flows.
- native approval flows that cannot yet be represented through `needs_input`.
- power-user interactions.

Requirements:

- Terminal input is recorded as raw transport evidence.
- Terminal input must not mutate Mission context or workflow state unless a structured path accepts an observation or command.
- UI labels the terminal lane as native/advanced when needed.

## Command Categories

### Mission-Native Command

Owned by Mission Entity commands, AgentExecution messages, or Agent execution semantic operations.

Examples:

- `/read <artifact>` -> Artifact read semantic operation or context attach message.
- `/attach <artifact>` -> AgentExecution context mutation message.
- `/verify` -> owner-scoped verification request.
- `/checkpoint` -> AgentExecution checkpoint message.
- `/blocked` -> structured blocked observation or owner command, depending on source.
- `/impact <symbol>` -> code intelligence semantic operation.
- `/summarize-diff` -> repository/worktree semantic operation.

Rules:

- Parser output is a typed invocation.
- Payloads use canonical schemas.
- Open Mission may autocomplete and preview, but daemon/Entity boundaries validate.
- Mission-native command names must not mirror provider-specific names unless the meaning is truly Mission-owned.

### Cross-Agent Runtime Command

Owned by AgentExecution runtime message descriptors.

Examples:

- interrupt
- nudge
- continue
- compact
- resume
- retry
- request status
- change reasoning effort

Rules:

- Command is shown only when present in the active AgentExecution descriptor.
- Delivery is best-effort unless the descriptor says otherwise.
- Context mutation is canonical only when accepted by Mission before delivery.
- Adapter delivery failure is journaled separately from command acceptance.

### Adapter-Scoped Command

Owned by AgentAdapter-declared runtime message descriptors.

Examples:

- provider-native compact variant.
- provider-specific planning toggle.
- provider-specific tool mode.
- slash command that exists only in one CLI and has no Mission equivalent.

Rules:

- UI labels command as adapter-scoped.
- Payload schema and delivery behavior come from the adapter descriptor.
- Command cannot directly mutate Mission workflow state.
- Any Mission effect must arrive later through a structured observation or Entity command.

### Terminal-Only Native Command

Owned by the provider CLI terminal experience.

Examples:

- undocumented provider slash commands.
- experimental provider UI flows.
- commands that require terminal rendering or modal behavior Mission cannot model.

Rules:

- Available only through the Terminal lane.
- Captured as terminal input/output evidence.
- Not listed as a Mission command.
- Candidate for later promotion if stable and valuable.

## Descriptor Model

AgentExecution protocol descriptors should grow toward this shape:

```ts
type AgentExecutionInteractionPosture =
  | 'structured-interactive'
  | 'structured-headless'
  | 'native-terminal-escape-hatch';

type AgentExecutionCommandPortability =
  | 'mission-native'
  | 'cross-agent'
  | 'adapter-scoped'
  | 'terminal-only';

type AgentExecutionMessageDescriptor = {
  type: string;
  label: string;
  description?: string;
  inputSchemaKey?: string;
  delivery: 'best-effort' | 'required' | 'none';
  mutatesContext: boolean;
  portability: AgentExecutionCommandPortability;
  adapterId?: string;
};
```

The exact schemas should be introduced in the AgentExecution Entity module when implementation begins. This spec defines the target semantics, not final type names.

## Slash Command Resolution

Slash command resolution should be a daemon-owned parse and validation path, with Open Mission providing autocomplete and previews.

Resolution order:

1. Mission-native command registry.
2. Active AgentExecution cross-agent runtime message descriptors.
3. Active AgentExecution adapter-scoped runtime message descriptors.
4. Terminal-only hint when the operator is focused in the Terminal lane.

The parser returns one of:

- Entity command invocation.
- AgentExecution message invocation.
- Agent execution semantic operation invocation.
- terminal-only raw input intent.
- parse error with expected input shape.

The parser must not silently fall through to raw terminal input from the Mission chat prompt. Terminal-only input requires Terminal focus or an explicit operator choice.

## Journaling Rules

Semantic journal records include:

- accepted AgentExecution messages.
- context mutations accepted by Mission.
- delivery attempts and delivery outcomes.
- accepted Agent signals.
- runtime facts produced by semantic operations.
- owner Entity effects and workflow events where applicable.
- command parse failures when they are operator-visible and relevant.

Transport evidence includes:

- PTY terminal recordings.
- stdout/stderr chunks.
- provider JSON payloads.
- raw parser tails.
- terminal-only slash command input and output.

Promotion rule:

```text
transport evidence becomes semantic truth only through a daemon-owned structured acceptance path
```

## Implementation Phases

### Phase 1: Document And Preserve

- Accept ADR-0006.10.
- Keep existing terminal-capable AgentExecution support.
- Keep Mission UI prompt delivery structured.
- Preserve semantic journal versus terminal recording separation.
- Add execution posture terminology to snapshots when implementation work begins.

### Phase 2: Mission-Native Slash Commands

- Introduce a small Mission-native slash command registry.
- Support autocomplete in Mission UI.
- Route parsed commands to Entity commands, AgentExecution messages, or semantic operations.
- Begin with high-value commands: read, attach, checkpoint, blocked, verify, summarize diff, impact.

### Phase 3: Runtime Message Descriptor Expansion

- Add `portability` metadata to AgentExecution message descriptors.
- Let adapters advertise adapter-scoped commands.
- Render adapter-scoped commands distinctly in Mission UI.
- Keep unsupported provider slash commands terminal-only.

### Phase 4: Structured Headless Productization

- Make structured headless the default posture for unattended/routine/verification work.
- Require useful structured progress and message output for headless flows.
- Use Agent connection tests and diagnostics to improve trust before launch.

### Phase 5: Terminal Residue Reduction

- Review terminal-only commands used frequently by operators.
- Promote stable portable intents into Mission-native or cross-agent commands.
- Promote stable non-portable intents into adapter-scoped descriptors.
- Delete duplicate command names and old compatibility aliases when promotion happens.

## Validation Strategy

- Unit-test slash command parsing into typed invocations.
- Unit-test descriptor filtering by execution posture and adapter capabilities.
- Unit-test that Mission chat prompt submission does not produce raw terminal input.
- Unit-test that terminal-only commands are recorded as transport evidence only.
- Integration-test structured headless execution without terminal attachment.
- Integration-test structured interactive execution with terminal attachment and MCP-backed signals.
- Replay-test semantic journals without terminal recordings.

## Open Questions

- Should terminal-only command evidence appear in the main AgentExecution timeline by default, or only in an expandable transport evidence view?
- Which first ten Mission-native slash commands produce the highest operator value?
- Should adapter-scoped commands live in the base AgentExecution message descriptor shape or a nested adapter extension field?
- What UI label best communicates non-portable adapter commands without making them feel broken?
- Should connection tests report which execution postures an adapter can support successfully?
