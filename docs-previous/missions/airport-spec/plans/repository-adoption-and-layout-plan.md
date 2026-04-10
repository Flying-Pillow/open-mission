---
layout: default
title: Repository Adoption And Layout Plan
nav_exclude: true
---

# Repository Adoption And Layout Plan

This plan translates the repository layout and first-mission bootstrap architecture into implementation work.

It is specifically about:

- moving tracked mission dossiers under `.mission/missions/`
- allowing first-mission bootstrap inside the newly created mission worktree
- supporting repositories that use Mission locally without requiring the original checkout to be modified first
- keeping a minimal machine-local registered-repository list in config.json
- exposing registered repositories to Tower so repository mode can switch with `/repo` and register new checkouts with `/add-repo`

## Implementation Law

The rewrite must follow these rules.

1. Repo control remains repository-bound and stored under `.mission/`.
2. Mission must not move repo control into user-scoped config.
3. The canonical tracked mission dossier path is `.mission/missions/<mission-id>/`.
4. The original local checkout must not need to be dirtied before the first mission can begin.
5. First-mission bootstrap must be able to initialize `.mission/settings.json` inside the newly created mission worktree.
6. The first mission branch may contain both repo bootstrap content and first mission dossier content in one commit series.
7. Mission must support local contributor mode where `.mission/` is gitignored by repository policy.
8. Mission lifecycle must not be derived from folder placement.
9. No compatibility shim should preserve the old top-level `missions/` repository layout.
10. User config may store registered repository checkout paths, but it must not become the authority for repo control.

## Desired End State

At the end of this work, the system should have:

1. one canonical tracked repository namespace under `.mission/`
2. one canonical tracked mission dossier path under `.mission/missions/<mission-id>/`
3. one first-mission flow that can bootstrap a repo from the mission branch worktree
4. zero requirement for a standalone repository bootstrap PR before mission start
5. clear support for both shared Mission mode and local contributor mode
6. one minimal machine-local registered-repository list in config.json
7. one canonical repo-level switch command `/repo`
8. one canonical repo registration command `/add-repo`

## Phase Order

### Phase 1: Path And Layout Cutover

Required output:

- path helpers resolve tracked missions under `.mission/missions/`
- mission-worktree discovery resolves `.mission/missions/<mission-id>/`
- tests and docs stop assuming a top-level `missions/` directory

Implementation tasks:

1. Refactor repository path helpers to return `.mission/missions` as the tracked catalog root.
2. Update mission descriptor discovery and mission-worktree detection code.
3. Update tests that construct mission directories manually.
4. Rewrite docs that still describe top-level `missions/` storage.

### Phase 2: First-Mission Bootstrap In Worktree

Required output:

- issue-driven mission start no longer requires a standalone repository bootstrap PR
- first mission preparation can initialize `.mission/settings.json` inside the new mission worktree

Implementation tasks:

1. Replace the mandatory bootstrap gate before mission preparation.
2. Extend mission preparation to initialize repo control in the new worktree when absent.
3. Commit repo control bootstrap and initial mission dossier together on the mission branch.
4. Keep the original checkout untouched until the user explicitly updates it.

### Phase 3: Surface Semantics

Required output:

- Tower and CLI can distinguish between not-yet-pulled local checkout state and mission-startable repository state
- uninitialized repos are still startable for first mission creation

Implementation tasks:

1. Redefine repo initialization status exposed to surfaces.
2. Replace blocking setup messaging with first-mission bootstrap affordances.
3. Ensure mission worktree relaunch and mission discovery keep working after the path cutover.

### Phase 4: Local Contributor Mode

Required output:

- repositories may gitignore `.mission/` and still use Mission locally
- docs explain the tradeoff between local-only and shared Mission usage

Implementation tasks:

1. Define local-only expectations clearly in docs and status surfaces.
2. Ensure daemon behavior does not assume `.mission/` must be tracked to be valid locally.
3. Keep user-scoped config limited to machine defaults only.

### Phase 5: Registered Repository List

Required output:

- Mission stores explicit registered repository checkout paths in user config
- later delivery logic has a safe machine-local place to look up which checkout should receive a pull after GitHub merge

Implementation tasks:

1. Add a minimal `registeredRepositories` list to Mission user config.
2. Register a repo when Mission first uses it from a real checkout path.
3. Keep the stored record minimal: checkout path only.
4. Treat this record as machine-local routing state only, not as repo control authority.

### Phase 6: Multi-Repo Surface Commands

Required output:

- Tower can list registered repositories and switch repository mode with `/repo`
- Tower can register a repo checkout path and switch to it with `/add-repo`
- repository switching reuses the existing repository-keyed daemon model instead of introducing per-repo command names

Implementation tasks:

1. Expose registered repositories through daemon control APIs.
2. Build the repo list only from explicit registered config entries.
3. Add `/repo` picker and direct-match handling in Tower repository mode.
4. Add `/add-repo` path registration and immediate switch behavior.
5. Keep repo-level actions scoped to the selected repository after the switch.

## Risks To Manage

The main risks are:

- duplicate mission detection before default-branch bootstrap is merged or pulled
- UI confusion between local checkout state and repo branch state
- stale assumptions that `.mission/settings.json` must already exist in the original checkout
- accidental leakage of local-only `.mission/` state into shared workflows without explicit intent
- ambiguous repo labels when multiple registered repos share the same short name

## Success Criteria

This work is complete when:

- docs consistently describe `.mission/missions/<mission-id>/` as the tracked mission root
- first mission start works from a repo whose original checkout does not yet contain `.mission/settings.json`
- the first mission branch can bootstrap Mission and create the mission dossier in the same flow
- Mission can still operate in a repo where `.mission/` is gitignored for local-only use