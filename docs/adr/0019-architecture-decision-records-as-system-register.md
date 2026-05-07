---
layout: default
title: Architecture Decision Records As System Register
parent: Architecture Decisions
nav_order: 19
status: accepted
date: 2026-05-06
decision_area: architecture-register
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission uses `docs/adr/` as the durable architecture register for the whole Mission system.

An ADR is not a loose note. Each accepted ADR records one architecture rule or decision that future implementation must obey. Together, the accepted ADR set is the logical registration of Mission's architecture: ownership, vocabulary, runtime boundaries, persistence rules, surface boundaries, compatibility policy, and refactor constraints.

`CONTEXT.md` remains the canonical glossary and relationship map. ADRs explain the decisions and trade-offs behind those terms. When a term or relationship changes, update `CONTEXT.md`; when the change is hard to reverse, surprising without context, or resolves a real trade-off, record or update the relevant ADR.

The old `specifications/` tree is no longer part of the active architecture corpus. It was historical input while decisions were migrated, but it does not outrank `CONTEXT.md`, the Mission constitution, or accepted ADRs. If an old specification contradicts accepted ADRs or current glossary language, the ADR and glossary win.

Before deleting or ignoring any future specification-like working document, any still-relevant architecture rule in that file must be represented in one of these places:

1. `CONTEXT.md` for domain language and relationships
2. an accepted ADR for durable architecture decisions
3. implementation task artifacts for temporary execution detail that should not govern future architecture

Once that check is complete, stale specification material should be deleted rather than preserved as parallel truth. Mission's clean-sheet discipline applies to documentation too: outdated spec folders, compatibility-era plans, and duplicate architecture descriptions create the same kind of ambiguity as duplicate runtime code.

Architecture changes must therefore follow this documentation order:

1. sharpen or add the glossary terms in `CONTEXT.md`
2. record durable decisions in `docs/adr/`
3. update implementation plans or temporary specs only as short-lived working aids
4. delete stale or superseded specification material in the same bounded change when it stops being authoritative

This makes the architecture navigable for humans and agents: read `CONTEXT.md` for language, read `docs/adr/` for law, and treat superseded working specs as removable source material after migration.
