---
layout: default
title: Spec-Driven Development
parent: Core Workflows
nav_order: 1
description: How Mission keeps AI work tied to explicit artifacts and workflow gates.
---

Mission uses artifacts to make intent durable before execution begins.

| Artifact | Purpose |
| --- | --- |
| BRIEF.md | Why the Mission exists |
| PRD.md | What must be true for the change to matter |
| SPEC.md | How the change will be built |
| PLAN.md | Which Mission tasks execute the spec |
| VERIFICATION.md | What proves the work is correct |
| AUDIT.md | What remains risky before delivery |

The point is not more documents. The point is a smaller command surface for agents: each task receives bounded instructions, relevant artifacts, and a clear gate.

When a gate fails, the Mission does not pretend the agent is done. The operator sees the evidence and decides the next command.
