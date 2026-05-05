---
layout: default
title: Repository Setup Before Mission Start
parent: Architecture Decisions
nav_order: 16
status: accepted
date: 2026-05-04
decision_area: repository-setup
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Repositories that do not contain `.mission/settings.json` enter Repository setup mode after clone or registration. Airport presents a Repository setup screen for operator-editable Repository settings. It must not create a first issue, a preparation Mission, or a Mission worktree to initialize Repository control state.

Repository setup is Repository-owned Entity behavior. The surface gathers settings and calls the Repository setup command; it does not write `.mission/settings.json` directly. The daemon validates the submitted Repository settings, creates a setup branch and linked setup worktree, scaffolds `.mission/settings.json`, `.mission/workflow/workflow.json`, and the default workflow template preset, commits those files, pushes the branch, opens a pull request against the Repository default branch, attempts an immediate merge, falls back to an auto-merge request when immediate merge is blocked, and fast-forwards the local default branch after a completed setup merge.

Regular mission start commands remain unavailable until Repository setup state is present in the usable local checkout. A setup pull request is progress, not proof that the Repository is initialized. If auto-merge cannot complete because of branch protection, checks, permissions, or review requirements, Mission surfaces the pull request and keeps regular mission start disabled until the settings document is available locally.

The setup screen edits Repository settings only in the first implementation. Workflow law remains scaffolded from the default preset during setup and can later become an editable setup section without changing the ownership boundary: Repository setup still owns Repository control state, while Mission workflow definition remains repository-owned validated workflow law.

Consequences:

- `repository.setup` replaces `repository.prepare` as the Repository initialization command.
- The previous first issue titled `Prepare repo for Mission` is retired.
- The previous preparation Mission/worktree initialization path is retired.
- Airport renders setup before mission and issue work surfaces for uninitialized Repositories.
- Setup PR merge/auto-merge is best-effort and must report failure without pretending setup completed.
