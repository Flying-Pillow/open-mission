# Mission Constitution

**Status:** Supreme Law
**Applicability:** All Human Maintainers, Contributors, and AI Agents

## Preamble

We the maintainers of the Flying Pillow Mission system declare:

Mission is a governed mission orchestration system, not a collection of convenience scripts or markdown.

This repository exists to enforce repository-backed workflow law, provider-neutral agent runtime orchestration, and tower-style operator surfaces through explicit domain boundaries.

We reject accidental architecture. We reject vague ownership. We reject procedural sprawl disguised as speed.

The system must remain spec-driven, mission-centered, repo-native, and object-oriented.

---

## Article I: The Sovereign Unit Is The Mission

1. All meaningful work is bounded by a Mission.
2. A Mission is not merely a ticket reference. It is the governed unit that owns intent, artifacts, stage transitions, gate legality, and delivery readiness.
3. The canonical mission workspace is repo-local under `.mission/worktrees`.
4. The canonical artifact chain is `BRIEF.md`, `PRD.md`, `SPEC.md`, `PLAN.md`, `VERIFICATION.md`, and `AUDIT.md`.
5. No feature, fix, refactor, docs change, or delivery workflow may bypass the Mission model.

---

## Article II: Repo-Native Authority

1. Mission is repo-native first. Repository state outranks editor-local convenience.
2. Repo-local configuration belongs in `.mission/settings.json`.
3. Mission roots, tracking settings, runtime defaults, and future adapter selection must derive from repository law before editor overrides are consulted.
4. The repository is the source of truth. IDE state is an optional projection.

---

## Article III: Physical Topology

The monorepo is intentionally product-shaped and must remain explicit about ownership.

1. `packages/core` owns mission manifests, artifact law, stage law, gate evaluation, status projection, repository config, and platform-neutral domain contracts.
2. `packages/core` also owns provider-neutral coding-agent runtime contracts and orchestration.
3. `apps/airport/terminal` owns the Mission terminal surface and sidecar-oriented repository workflow entrypoint.
4. `packages/tsconfig` owns shared TypeScript policy.

No workspace may absorb another workspace's responsibility out of convenience.

---

## Article IV: The OOD Fortress

Object-Oriented Design is mandatory for domain logic in this repository.

1. Domain behavior must live in named entities, policies, services, repositories, orchestrators, or adapters with clear ownership.
2. Files full of loose procedural functions are forbidden for mission-domain behavior.
3. If behavior mutates mission state, interprets workflow law, maps platform concepts, or coordinates execution, it must be owned by an explicit class or strict contract-bearing object.
4. Free functions are allowed only when they are genuinely low-level, domain-agnostic helpers with no workflow authority.

OOD ownership rules:

1. Entities own invariants around their own state.
2. Policies own legality checks and rule evaluation.
3. Repositories own storage-path and persistence concerns.
4. Adapters own external platform translation.
5. Orchestrators own cross-boundary coordination but not domain truth.
6. Domain classes must receive external capabilities through explicit Dependency Injection and depend on interfaces or ports, never on concrete adapter implementations.

Explicit anti-patterns:

1. putting business rules in CLI command handlers
2. putting provider-specific logic in presentation surfaces
3. putting mission state transitions in utility files
4. scattering workflow decisions across unrelated helper functions

---

## Article V: Specification Before Execution

1. `PRD.md` captures original context and bounded objective.
2. `SPEC.md` is the normative implementation blueprint.
3. `TASKS.md` is the canonical execution ledger derived from the spec, not from ad hoc implementation intuition.
4. `VERIFY.md` proves correctness.
5. `AUDIT.md` records final gate and delivery readiness evidence.

Implementation must not outrun specification.

In particular:

1. implementation may not begin if `TASKS.md` is structurally placeholder-grade
2. workflow legality belongs to gates and manifest policy, not contributor discretion
3. stage transitions must remain mechanically enforced

---

## Article VI: Provider-Neutral Execution

1. Mission must never collapse into a GitHub-only, Copilot-only, or VS Code-only architecture.
2. External systems must be isolated behind explicit adapter contracts.
3. Coding-agent execution belongs behind provider-neutral runtime interfaces.
4. Issue tracking and delivery platforms belong behind provider-neutral platform adapter interfaces.

Examples of acceptable adapter categories:

1. runtime adapters such as Copilot CLI today and future providers later
2. platform adapters such as GitHub now and Jira, Linear, GitLab, or other systems later

The core domain must not speak raw provider protocol shapes.

---

## Article VII: Platform Adapter Law

1. The core domain may define platform-neutral contracts such as mission briefs, issue status updates, and pull request creation intents.
2. Concrete adapters must translate external ecosystems into Mission concepts rather than leaking foreign terminology inward.
3. GitHub labels or templates may inform mission type inference, but the resulting type must be expressed in Mission's own vocabulary such as `fix`, `feat`, `docs`, `refactor`, or `task`.
4. Adapter inference is preferred over repeated manual CLI flags when the external platform already contains reliable intent signals.
5. When platform metadata is insufficient, Mission must fail clearly or prompt explicitly rather than guessing silently.
6. The `domain` layer may depend on `interfaces`, but it must not import from concrete `platforms` or concrete `agents` implementations.

---

## Article VIII: The Airport WEB/NATIVE Is A Control Surface, Not The Domain

1. `airport` is an operator surface.
2. It is an interrface to the daemon that controls all running missions

---

## Article IX: Presentation Surfaces Are Projections

1. The panels, graphs, and tree views are read-write presentation surfaces over governed state.
2. Presentation layers must consume normalized domain state and adapter outputs.
3. They must not embed provider-specific execution loops, mission legality rules, or storage authority.
4. UI may visualize governance. UI may not replace governance.

---

## Article X: Zero-Legacy Mandate

1. Backward-compatibility shims are disfavored and require explicit justification.
2. Legacy paths must not survive merely because they once existed.
3. When architecture changes, stale generated outputs, dead files, obsolete terminology, and outdated workflow artifacts must be deleted.
4. The repository must converge to one active truth, not dual systems in prolonged parallel.

Mission favors hard clarity over soft compatibility drift.

---

## Article XI: Naming And Terminology Discipline

1. Public terminology must align with Mission's current model: mission, stage, gate, artifact, flight, operator, runtime, adapter.
2. Deprecated mental models and extracted-monorepo residue must be removed as the architecture stabilizes.
3. New names must reveal ownership and role. A class name should tell the reader whether it is an entity, policy, adapter, repository, orchestrator, or presentation model.

---

## Article XII: Deterministic Validation

1. Every meaningful change must be validated by tools.
2. Acceptable proof includes build output, typecheck success, test results, gate evaluation, generated artifact state, or other deterministic machine evidence.
3. Visual confidence, conversational confidence, and code-reading confidence are insufficient substitutes for execution evidence.
4. If a change cannot be validated end-to-end, the limitation must be stated explicitly.

---

## Article XIII: Constitutionality Test For New Code

Before new code is added, contributors must be able to answer yes to all of the following:

1. Does this code have an explicit owner and architectural role?
2. Is the behavior located in the right workspace?
3. Is mission law still enforced by the domain rather than by UI or CLI convenience?
4. Is the design adapter-friendly rather than hardcoded to one provider or platform?
5. Is the change repo-native and consistent with `.mission` as canonical state?
6. Is the implementation object-oriented where domain behavior is involved?
7. Can the behavior be validated deterministically?

If the answer is no, the design is incomplete.
