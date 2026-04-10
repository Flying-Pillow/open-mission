---
layout: default
title: Repository Layout And Adoption
nav_exclude: true
---

# Repository Layout And Adoption

This document defines the canonical repository layout for Mission tracked state and the supported adoption modes for repositories that do not yet use Mission.

If this document conflicts with older notes that place mission dossiers under a top-level `missions/` directory, this document wins.

## Decision Summary

Mission tracked repository state lives under one repository-bound namespace:

```text
.mission/
  settings.json
  missions/
    <mission-id>/
      BRIEF.md
      mission-control/
        mission.json
        ...
```

The canonical tracked mission dossier path is:

- `.mission/missions/<mission-id>/`

The canonical repository settings path is:

- `.mission/settings.json`

Mission worktrees remain external local materializations outside the original checkout.

Mission lifecycle must not be inferred from folder placement.

There is no authoritative `pending/active/completed` folder taxonomy.

## Why `.mission/missions` Wins

Two subfolder names were considered for tracked mission content:

- `.mission/missions`
- `.mission/worktrees`

The canonical choice is `.mission/missions`.

Reasoning:

1. The tracked branch-owned content is mission history, not a local materialization primitive.
2. A `worktree` is a local Git checkout concept, not the semantic identity of the tracked dossier.
3. Keeping tracked mission content under `.mission/missions` leaves `.mission/worktrees` available for future local-only bookkeeping if it is ever needed.
4. Contributors and agents can be instructed to treat `.mission/` as a protected Mission namespace more easily than a top-level `missions/` directory in the project root.

`.mission/worktrees` may exist in the future for local materialization metadata, but it is not the canonical tracked mission dossier location.

## Storage Scopes

Mission uses three storage scopes.

### 1. Repository-Bound Tracked Control State

Tracked control state lives under `.mission/` inside the Git repository.

Examples:

- `.mission/settings.json`
- `.mission/missions/<mission-id>/...`

This state is repository-bound and transferable through Git history when the repository chooses to adopt Mission as shared project infrastructure.

### 2. Local Mission Worktree Materialization

Mission worktrees are local checkouts created outside the original repository checkout.

Example:

```text
~/missions/<repo-name>/<mission-id>/
```

This path is local materialization state.

It is not the semantic storage root of tracked mission data.

The tracked mission data inside that worktree still lives at `.mission/missions/<mission-id>/`.

### 3. Machine-Local Runtime State

Daemon runtime state remains outside the repository and outside mission history.

Examples include socket files, session manifests, and local process metadata.

Mission may also keep a minimal machine-local registered-repository list in user config so Mission can remember which repository checkouts this machine should offer in repo-level views.

That registry is not repository authority.

It is only machine-local routing state.

The supported shape is a `registeredRepositories` list in `~/.config/mission/config.json`, for example:

```json
{
  "registeredRepositories": [
    {
      "checkoutPath": "/home/ronald/mission"
    }
  ]
}
```

When Mission starts from a repository checkout, it may register that checkout automatically in this machine-local list.

When Tower renders repository-level repo switching, the available repository set should come only from registered repositories in user config.

There is no scan-based repository inference from mission worktree folders.

## Repository Modes

Mission supports two repository modes.

### Shared Mission Mode

In shared Mission mode, `.mission/` is tracked repository state.

This means:

- `.mission/settings.json` is committed
- `.mission/missions/<mission-id>/...` is committed on mission branches
- Mission state is reviewable, transferable, and handoff-friendly

This is the canonical long-term Mission architecture.

### Local Contributor Mode

In local contributor mode, the repository may gitignore `.mission/`.

This means:

- contributors can still use Mission locally
- `.mission/` stays repository-bound in path semantics, not user-config semantics
- Mission state is intentionally private and non-transferable for that repository
- the repository is not considered shared Mission infrastructure even if contributors use Mission locally

This mode lowers the barrier for contributors working in repositories that will never adopt Mission as tracked project infrastructure.

The important rule is that local contributor mode changes sharing policy, not path semantics.

Mission still uses `.mission/`, but the repository chooses not to track it.

## First-Mission Bootstrap Model

Mission must support starting from a repository that does not yet contain `.mission/settings.json` on the current checkout.

The daemon must not require the original local checkout to be modified before a contributor can begin using Mission.

### Required First-Mission Flow

When a user selects an issue in a repository that is not yet Mission-enabled on the current checkout, Mission should:

1. resolve the repository and issue from the original checkout
2. create the mission branch and external mission worktree first
3. initialize `.mission/settings.json` inside that new worktree if absent
4. create `.mission/missions/<mission-id>/...` inside that same worktree
5. commit the bootstrap and first mission dossier together on the mission branch
6. push the mission branch
7. optionally open a single PR for shared Mission adoption and the first mission
8. allow work to continue immediately from the mission worktree without touching the original local checkout

This is the authoritative first-mission bootstrap model.

The previous model of a mandatory standalone repository bootstrap PR before any mission may exist is not the target architecture.

## Original Checkout Rules

The original local checkout must not be treated as the only valid place where Mission can become initialized.

Required behavior:

1. a repo may be uninitialized in the original checkout and still be startable through Mission
2. the first mission worktree may contain the first `.mission/settings.json`
3. the original checkout may remain untouched until the user explicitly pulls or merges changes
4. Mission should treat any Git repo as startable
5. Mission may register a repository checkout automatically when it starts from that real repo
6. the machine-local config may list registered repositories for repo switching and later delivery routing

## Multi-Repo Surface Commands

Tower repository mode must support repo-level switching without inventing dynamic slash commands per repository name.

The canonical repo-level commands are:

1. `/repo`
  Opens a picker of registered repositories and switches Tower to the selected repository.
2. `/repo <query>`
  Switches directly when the query matches exactly one registered repository.
3. `/add-repo`
  Prompts for a filesystem path to a Git checkout, registers it in user config, and switches Tower to it.
4. `/add-repo <path>`
  Registers and switches directly without the extra prompt.

Repository-level actions such as `/setup` and `/issues` always operate on the currently selected repository.

## Mission Dossier Shape

The canonical tracked mission dossier layout is:

```text
.mission/
  settings.json
  missions/
    <mission-id>/
      BRIEF.md
      mission-control/
        mission.json
        01-PRD/
          PRD.md
          tasks/
            01-prd-from-brief.md
```

All additional Mission artifacts materialized during workflow progression remain under `.mission/missions/<mission-id>/`.

## Non-Goals

This model does not:

- move repo control into user config
- derive mission status from directory buckets
- require a top-level `missions/` folder in the repository root
- require the original checkout to be dirtied before the first mission can begin

## Contributor Guidance

Because all Mission tracked state lives under `.mission/`, contributors and agents can be guided with a simple rule:

- do not modify `.mission/` unless you are explicitly working on Mission control or mission dossier content

This is one of the main reasons to prefer `.mission/missions` over a project-root `missions/` directory.