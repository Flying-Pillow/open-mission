---
name: entity-contract-documentation
description: Document or audit an Entity from its class, schema, and contract. Use when creating docs/architecture/entities pages, entity ERDs, method/property tables, or checking whether Entity documentation matches the canonical contract and schema.
---

# Entity Contract Documentation

Write Entity documentation as a human-readable contract mirror and architecture check. The docs must help a maintainer understand the Entity without copying source code line-for-line.

## Source Order

For Mission entities, read these before writing:

- `CONTEXT.md` for domain words and definitions.
- `.agents/constitution.md` for ownership and object boundaries.
- Relevant ADRs in `docs/adr/`, especially Entity architecture, naming, command surface, runtime, and AgentExecution decisions.
- The Entity class: `packages/core/src/entities/<Entity>/<Entity>.ts`.
- The Entity schema: `packages/core/src/entities/<Entity>/<Entity>Schema.ts`.
- The Entity contract: `packages/core/src/entities/<Entity>/<Entity>Contract.ts`.

Treat the contract as the source of truth for remote methods and events. Treat the schema as the source of truth for properties, subschemas, payloads, and results. Treat the class as the source of truth for behavior and invariants. The documentation must cross-control all three: if one disagrees with another, name the ambiguity instead of smoothing it over.

Do not invent new domain terms, layers, or owner names in the documentation. Only use vocabulary already anchored in `CONTEXT.md`, accepted ADRs, or the canonical class/schema/contract surface. If the existing vocabulary is insufficient, stop and mark it as a doctrine gap rather than coining a new term.

## Document Shape

Create or update `docs/architecture/entities/<entity-slug>.md`. Each Entity docs page should include:

- A short definition in domain language: what the Entity owns, what it governs, and what it does not own.
- Source links to the class, schema, contract, and relevant ADRs.
- Responsibilities and non-responsibilities.
- Major seams and surface boundaries: what crosses the Entity boundary, what stays daemon-internal, what is projected for UI, and what is delegated to sibling Entities or runtime collaborators.
- A method table based on the contract. Include method name, kind (`query`, `mutation`, or `command`), input schema, result schema, behavior, likely callers, and side effects.
- An event table based on the contract. Include event name, payload schema, publisher, subscribers/surfaces, and meaning.
- A property table based on the Entity schema. Group properties by role instead of alphabetically: identity, ownership/scope, governed child entities or processes, state dimensions, interaction contract, transport, timeline/journal, telemetry, timestamps.
- A schema/subschema map that explains the major schema boxes in plain language.
- An ERD-like Mermaid diagram. Use it as a pressure gauge: if the graph becomes unreadable, add a short note describing which concept is doing too much or which supporting concept should be promoted/renamed.
- One or more Mermaid flow diagrams for the main runtime flows that matter to the Entity, such as launch, command handling, intake/normalization, routing, persistence, or terminal interaction. Prefer a small number of readable diagrams over one giant diagram.
- A cross-control checklist that states whether class, schema, contract, and docs agree. List unresolved naming or ownership questions explicitly.

## Method Discipline

For every contract method:

- Preserve the exact method name.
- Name the input and result schemas exactly.
- Describe the caller's intent in one sentence.
- Describe whether it only reads, mutates in-memory runtime, persists state, emits events, or delegates to another Entity.
- Name known callers from the codebase when they are discoverable.
- If a method has no clear caller or unclear behavior, mark it as a documentation finding.

## Property Discipline

For every top-level Entity property:

- Preserve the exact property name.
- Name the schema or primitive type.
- Explain the role in the domain model.
- Point to important subschemas instead of expanding every field mechanically.
- Explain derived/duplicated properties by naming their source and why the projection exists.

For entities with large runtime surfaces, also explain which properties are canonical truth, which are derived projections, and which exist only as linkage to another owned surface.

## Naming Pressure

Flag vague suffixes unless their role is explicitly documented: `Data`, `Snapshot`, `Info`, `State`, `Record`, `View`, `Payload`, `Response`.

For Mission AgentExecution, be especially strict: `AgentExecution` governs one `AgentExecutionProcess`. OS/process-level execution is the center. Terminal, protocol, timeline, journal, telemetry, and UI command projections are supporting surfaces, not peer centers.

For Mission AgentExecution, do not describe a separate `runtime` layer, `runtime` type family, or `runtime` ownership surface around the execution itself. The live AgentExecution instance is the runtime owner; AgentExecutionRegistry is only collection and lookup.

For Mission AgentExecution specifically, enforce the latest vocabulary discipline from ADRs and current docs:

- `message` is the canonical runtime-boundary term.
- `observation` is daemon-internal normalization vocabulary, not a public peer term.
- `messageRegistry` names the live available-only message catalog.
- Terminal state is Terminal-owned; AgentExecution keeps linkage and execution-facing lane facts.
- Journal, current state, and timeline serve different consumers and should not be collapsed.

## Output Style

Write for maintainers, not generators. Prefer compact tables and short explanations. Link to source files where necessary instead of pasting code. Do not hide complexity: if the contract/schema graph feels too large, say what that reveals.

When the page is design-first and implementation is in flux, optimize for clarity of seams, flows, and ownership boundaries over exhaustive field-by-field expansion.