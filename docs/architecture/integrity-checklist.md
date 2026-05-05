---
layout: default
title: Integrity Checklist
parent: Architecture
nav_order: 14
description: Quick checks for architecture changes.
---

Before changing Mission architecture, answer yes to these checks:

- Does the behavior have an explicit owner?
- Is domain behavior inside an Entity, policy, repository, adapter, orchestrator, or strict contract-bearing object?
- Does the surface remain a surface?
- Are provider details isolated behind adapters?
- Are persisted and accepted shapes validated by schemas?
- Does the change follow current ADRs or record a new decision?
- Can the change be verified deterministically?

If the answer is no, the design is not ready.
