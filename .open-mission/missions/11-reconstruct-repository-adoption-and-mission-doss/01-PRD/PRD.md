---
title: "PRD: #11 - Reconstruct repository adoption and mission dossier layout"
artifact: "prd"
createdAt: "2026-04-10T15:51:25.000Z"
updatedAt: "2026-04-10T15:51:25.000Z"
stage: "prd"
---

Branch: mission/11-reconstruct-repository-adoption-and-mission-doss

## Outcome

- Establish one coherent repository adoption model in which Mission-controlled repository state lives under `.mission/` and each tracked mission dossier lives directly under `.mission/missions/<mission-id>/`.
- Make first-mission bootstrap work from the mission branch worktree so a repository can become Mission-enabled without requiring a separate bootstrap PR or changes to the original checkout first.
- Separate tracked repository history from machine-local runtime state and machine-local repository routing state so the mission dossier remains the durable, reviewable source of repository-owned mission truth.

## Problem Statement

- The repository adoption model existed in specifications and implementation work, but the historical mission that established it was not represented as a first-class Mission dossier backed by a real issue intake anchor.
- Mission’s path model had drifted: the intended mission-root dossier layout and the implemented nested subdirectory model had diverged, which made the repository history, runtime model, and operator mental model harder to reconcile.
- Without a clear PRD for this reconstructed mission, the repository lacks a durable statement of what repository adoption, first-mission bootstrap, and mission dossier storage are supposed to guarantee as a single product outcome.

## Success Criteria

- The canonical tracked Mission namespace is `.mission/`.
- The canonical tracked mission dossier path is `.mission/missions/<mission-id>/` with `BRIEF.md`, `mission.json`, and staged artifacts rooted directly in that dossier.
- Repository settings remain at `.mission/settings.json`.
- Mission lifecycle is not inferred from pending/active/completed directory buckets.
- First-mission bootstrap can initialize `.mission/settings.json` inside the newly created mission worktree.
- The first mission branch can contain both repository bootstrap content and the first mission dossier.
- Mission supports both shared tracked `.mission/` usage and local-only gitignored `.mission/` usage.
- Registered repositories remain a minimal machine-local routing list rather than repository authority.
- Repository switching semantics are expressed through `/repo` and `/add-repo`, not per-repository command variants.

## Constraints

- Do not move repository control into user-scoped config.
- Do not preserve the old top-level `missions/` repository layout.
- Do not preserve the nested `mission-control/` dossier layout.
- Do not introduce compatibility shims, fallback readers, aliases, or dual-path support for obsolete dossier shapes.
- Do not require the original local checkout to be dirtied before the first mission can begin.
- Do not treat external worktree paths as the semantic storage root of tracked mission history.
- Keep machine-local runtime state and machine-local repository registration separate from tracked mission dossier state.

## Non-Goals

- Redesign the workflow engine beyond what is required to support the repository adoption and first-mission bootstrap model.
- Preserve backward compatibility with obsolete dossier layouts or transitional naming.
- Define later-stage specification, implementation, audit, or delivery details that belong in subsequent mission artifacts.
- Treat local worktree management details as the canonical representation of tracked mission history.