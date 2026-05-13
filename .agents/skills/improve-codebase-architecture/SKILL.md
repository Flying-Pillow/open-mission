---
name: improve-codebase-architecture
description: Find deepening opportunities in a codebase, informed by the domain language in CONTEXT.md and the decisions in docs/adr/. Use when the user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more testable and AI-navigable.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in [LANGUAGE.md](LANGUAGE.md).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [LANGUAGE.md](LANGUAGE.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

This skill is _informed_ by the project's domain model. The domain language gives names to good seams; ADRs record decisions the skill should not re-litigate.

Mission-specific architecture work must also respect the current OOD reset:

- Domain behavior belongs in explicit Entity classes, policies, repositories, adapters, orchestrators, or strict contract-bearing objects.
- Entity behavior belongs in `<Entity>.ts`; validated shapes belong in `<Entity>Schema.ts`; remote method metadata belongs in `<Entity>Contract.ts`.
- Open Mission and other surfaces render daemon-owned state and command views; they do not own workflow law, Entity behavior, or persisted runtime truth.
- Adapters translate external systems into Mission concepts instead of leaking provider protocol shapes inward.

## Process

### 1. Explore

Read the project's domain glossary and any ADRs in the area you're touching first. For Mission, start with `CONTEXT.md`, `.agents/constitution.md`, and relevant files in `docs/adr/`; ADR-0012 and ADR-0015 are especially important when behavior or commands are involved.

Then use the Agent tool with `subagent_type=Explore` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?
- Where is Mission domain behavior sitting in loose functions, presentation surfaces, or provider-specific code instead of an explicit OOD owner?
- Where would a thick Entity class, Entity contract, workflow policy, or adapter make the interface smaller and the behavior more local?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and also in how tests would improve

**Use CONTEXT.md vocabulary for the domain, and [LANGUAGE.md](LANGUAGE.md) vocabulary for the architecture.** If `CONTEXT.md` defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly (e.g. _"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize:

- **Naming a deepened module after a concept not in `CONTEXT.md`?** Add the term to `CONTEXT.md` — same discipline as `/grill-with-docs` (see [CONTEXT-FORMAT.md](../grill-with-docs/CONTEXT-FORMAT.md)). Create the file lazily if it doesn't exist.
- **Sharpening a fuzzy term during the conversation?** Update `CONTEXT.md` right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing — skip ephemeral reasons ("not worth it right now") and self-evident ones. See [ADR-FORMAT.md](../grill-with-docs/ADR-FORMAT.md).
- **Want to explore alternative interfaces for the deepened module?** See [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md).

### 4. ADR frontmatter

Every new or updated ADR in `docs/adr/` must have frontmatter at the top of the file. The frontmatter `title` is the docs title, so do not add a duplicate first-level `#` heading in the body.

```yaml
---
layout: default
title: Decision Title
parent: Architecture Decisions
nav_order: 17
status: proposed | accepted | superseded
date: YYYY-MM-DD
decision_area: entity-model | entity-schema | entity-command-surface | workflow-law | state-store | runtime-data | agent-runtime | repository-setup | surface-selection | surface-preferences | adapter-boundary | implementation-discipline | language | architecture
owners:
	- maintainers
supersedes: []
superseded_by: []
---
```

Rules:

- `title` must match the decision title used in the file name.
- `parent` must be `Architecture Decisions` so the docs site can mount the ADR.
- `nav_order` must match the numeric ADR prefix without leading zeroes.
- `status` is usually `accepted`; use `proposed` only while the decision is still being grilled.
- `date` is the decision date or the date the ADR was last materially updated when the original date is unknown.
- `decision_area` must name the architectural owner or concern the ADR constrains.
- If an ADR supersedes or is superseded by another ADR, use ADR ids in `supersedes` or `superseded_by`.

When an ADR permits a deviation from the OOD constitution, include a short "Constitutionality" section in the body explaining why the deviation is bounded, who owns it, and what validation proves it remains safe.