# Mission Constitution

**Status:** Supreme Law
**Applicability:** All Human Maintainers, Contributors, and AI Agents

## Preamble

Mission is a governed software system, not a pile of scripts, helpers, or surface-specific shortcuts.

This repository exists to enforce repository-backed workflow law, provider-neutral runtime orchestration, and explicit domain ownership.

The architecture must remain mission-centered, repo-native, DRY, and object-oriented.

---

## Article I: Mission Sovereignty

1. All meaningful work is bounded by a Mission.
2. A Mission owns intent, artifacts, stage transitions, gate legality, and delivery readiness.
3. No feature, fix, refactor, docs change, or runtime path may bypass the Mission model.
4. Canonical mission state lives in the repository, not in editor-local or UI-local state.

---

## Article II: Repo-Native Authority

1. The repository is the source of truth.
2. Repo-local configuration and governed state outrank editor convenience, cached UI state, and local preferences.
3. `.mission` is canonical for Mission-backed repository state.
4. Presentation surfaces may reflect or edit governed state, but they do not own truth.

---

## Article III: Explicit Ownership

1. Every non-trivial behavior must have a single clear owner.
2. Workspace and module boundaries must remain product-shaped and responsibility-driven.
3. No workspace may absorb another workspace's responsibility for convenience.
4. If ownership is ambiguous, the design is incomplete.

Ownership rules:

1. Entities own invariants and stateful behavior.
2. Policies own legality and rule evaluation.
3. Repositories own persistence and path concerns.
4. Adapters own translation to external systems.
5. Contracts own cross-boundary method, event, and schema definitions.
6. Orchestrators own coordination across boundaries, but not domain truth.
7. UI owns presentation and interaction, but not workflow law.

---

## Article IV: DRY By Law

1. Every rule, workflow decision, translation, and schema must have one authoritative implementation.
2. Duplicated business logic across UI, CLI, daemon, adapters, or tests is forbidden.
3. Copy-pasted branching, parallel data shaping, and repeated protocol mapping are architecture failures, not harmless shortcuts.
4. Shared behavior must be extracted to the owning domain object, policy, repository, adapter, or contract.
5. Reuse must not come from vague utility sprawl; shared code must still have explicit ownership.
6. Shared payload shapes must come from canonical schemas and contracts, not local re-declarations.

---

## Article V: Object-Oriented Domain Design

1. Object-Oriented Design is mandatory for domain logic.
2. Mission behavior must live in explicit entities, policies, repositories, adapters, services, or orchestrators with named responsibilities.
3. Loose procedural files may support low-level helpers, but they must not own mission law, state transitions, execution rules, or platform translation.
4. Domain classes must depend on explicit contracts and injected capabilities, not hidden globals or concrete external implementations.
5. Behavior belongs with the object that has the authority to enforce it.
6. Browser-side and server-side surface logic should prefer explicit models, gateways, and registries over anonymous state bags when behavior is non-trivial.

Forbidden patterns:

1. Business rules in route handlers, CLI handlers, or UI components.
2. Mission state transitions in generic helper files.
3. Provider-specific logic in presentation surfaces.
4. Cross-cutting workflow rules scattered across unrelated modules.
5. Re-implementing domain payload shapes locally when a shared schema or contract already exists.

---

## Article VI: Contract-First Boundaries

1. Every daemon, entity, route, socket, and event boundary must be defined by an explicit shared contract.
2. Inputs must be parsed at ingress. Outputs must be parsed before they cross the boundary.
3. Event subscriptions, command invocations, query payloads, and snapshot payloads must use canonical schemas rather than ad hoc object shapes.
4. Entity data, command metadata, and transport-specific streams are separate contracts and must not be collapsed into one payload for convenience.
5. Thin transport layers are preferred: routes, gateways, and dispatchers should validate, forward, and translate, but not own business logic.

---

## Article VII: Specification Governs Execution

1. Specification outranks implementation intuition.
2. `PRD.md` defines the bounded objective.
3. `SPEC.md` defines the normative implementation blueprint.
4. `TASKS.md` defines the execution ledger derived from the spec.
5. `VERIFY.md` and `AUDIT.md` provide proof and closeout evidence.
6. Implementation must not outrun specification or bypass enforced workflow gates.

---

## Article VIII: Provider-Neutral Boundaries

1. The core domain must remain provider-neutral and platform-neutral.
2. External systems must be isolated behind explicit adapter contracts.
3. The domain must not import raw provider assumptions, terminology, or protocol shapes as core truth.
4. Surface implementations must adapt to Mission law, not redefine it.

---

## Article IX: Zero-Legacy Discipline

1. Dead paths, obsolete terminology, compatibility shims, and parallel truths must be removed aggressively.
2. Backward-compatibility is allowed only when explicitly justified by real migration need.
3. The repository must converge toward one active model, not preserve prior architectures indefinitely.

---

## Article X: Deterministic Validation

1. Every meaningful change must be validated by deterministic evidence.
2. Acceptable proof includes tests, typechecks, builds, gate evaluation, generated artifacts, or equivalent machine-verifiable results.
3. Confidence without execution evidence is not sufficient.
4. If validation is incomplete, the limitation must be stated explicitly.

---

## Article XI: Constitutionality Test

New code is constitutional only if the answer is yes to all of the following:

1. Does this behavior have one clear owner?
2. Is the logic implemented once in the proper layer?
3. Is domain behavior modeled through explicit objects or contracts rather than procedural sprawl?
4. Do all cross-boundary payloads use canonical shared schemas or contracts?
5. Does the repository remain the source of truth?
6. Are provider and platform details contained behind adapters?
7. Is specification still governing execution?
8. Can the result be validated deterministically?

If any answer is no, the design is incomplete.
