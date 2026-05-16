---
layout: default
title: Repository Setup
parent: Getting Started
nav_order: 2
description: Prepare a repository by creating its repository-owned Mission control state.
---

A repository is Mission-ready only after `.open-mission/settings.json` exists in the usable local checkout.

Setup is owned by the Repository Entity. Open Mission gathers operator choices, then calls the Repository setup command. The surface does not write `.open-mission` files directly.

## Setup Creates

- `.open-mission/settings.json`
- `.open-mission/workflow/workflow.json`
- `.open-mission/database/`
- the default workflow template preset
- a setup branch and setup worktree
- a pull request against the repository default branch

Mission attempts to merge the setup pull request and fast-forward the local default branch. If branch protection, checks, reviews, or permissions block the merge, setup remains in progress and regular Mission start stays disabled.

Repository setup is not a Mission. It creates repository control state so later Missions can run safely.
