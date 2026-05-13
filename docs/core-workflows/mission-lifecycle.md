---
layout: default
title: Mission Lifecycle
parent: Core Workflows
nav_order: 3
description: The normal path from Mission intake to delivery evidence.
---

A Mission is a governed unit of engineering work. Its lifecycle is derived from workflow law and current task progress, not from a surface-owned checklist.

| Stage | Output |
| --- | --- |
| Intake | BRIEF.md and initial Mission dossier |
| Requirements | PRD.md |
| Specification | SPEC.md and PLAN.md |
| Implementation | Task-level changes and VERIFICATION.md evidence |
| Audit | AUDIT.md and delivery readiness notes |

The Running Mission instance owns lifecycle behavior while the Mission is live. It coordinates child Entities, applies the Mission workflow definition, evaluates gates, and publishes read data for Open Mission.

Open Mission can request commands. It does not own the lifecycle.
