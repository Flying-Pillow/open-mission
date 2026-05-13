---
layout: default
title: Repository Initialization Before Mission Start
parent: Architecture Decisions
nav_order: 16
status: accepted
date: 2026-05-08
decision_area: repository-initialization
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Repositories that do not contain `.mission/settings.json` remain uninitialized after clone or registration. Open Mission presents the normal Repository control surface, not a separate setup screen or setup-only route. A stable Repository-scoped Agent execution is available on that surface from first load onward so initialization and later repository management happen in the same place. Mission must not create a first issue, a preparation Mission, or a Mission worktree to initialize Repository control state.

Repository initialization is Repository-owned Entity behavior. When a Repository is first added to Mission, the daemon immediately invokes the Repository initialization command to seed local Repository control state before the operator starts interacting with the Repository surface. The surface may gather settings directly or through Repository-scoped Agent execution interaction, then calls the Repository setup command; it does not write `.mission/settings.json` directly. The daemon validates the submitted Repository settings, creates a setup branch and linked setup worktree, scaffolds `.mission/settings.json`, `.mission/workflow/workflow.json`, and the default workflow template preset, commits those files, pushes the branch, opens a pull request against the Repository default branch, attempts an immediate merge, falls back to an auto-merge request when immediate merge is blocked, and fast-forwards the local default branch after a completed setup merge.

Regular mission start commands remain unavailable until Repository control state is present in the usable local checkout. A setup pull request is progress, not proof that the Repository is initialized. If auto-merge cannot complete because of branch protection, checks, permissions, or review requirements, Mission surfaces the pull request and keeps regular mission start disabled until the settings document is available locally.

The first implementation keeps Repository initialization bootstrap behavior inside Repository commands and the Repository-scoped Agent execution. Repository add/bootstrap is daemon-owned and immediate; agent interaction is used for ongoing management and for initialization work that still requires operator judgment. The Repository-scoped execution starts with daemon-supplied repository context including initialization state, Git sync status, and tracked Mission summaries so it can choose a useful first action from the actual Repository state. That execution is not a temporary setup assistant. It is the stable Repository manager surface that can later extend to ongoing repository operations such as issue sync, release work, or CI/CD coordination without introducing another route or another execution type. Workflow law remains scaffolded from the default preset during initialization and can later become an editable repository-management concern without changing the ownership boundary: Repository initialization still owns Repository control state, while Mission workflow definition remains repository-owned validated workflow law.

Consequences:

- `repository.initialize` replaces `repository.prepare` as the Repository bootstrap command that seeds local control state.
- The previous first issue titled `Prepare repo for Mission` is retired.
- The previous preparation Mission/worktree initialization path is retired.
- Open Mission renders one Repository surface for initialized and uninitialized Repositories.
- Repository-scoped Agent execution is the primary control surface for initialization and later repository management.
- Repository add invokes `repository.initialize` immediately after clone or registration.
- Setup PR merge/auto-merge is best-effort and must report failure without pretending setup completed.
