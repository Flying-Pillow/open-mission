---
layout: default
title: Product Comparison
parent: Reference
nav_order: 3
description: Where Mission differs from prompt, spec, and agent orchestration tools.
---

Mission belongs in the same broader movement as Spec Kit, BMAD, and GSD: make AI-assisted development less improvised and more reliable. The difference is the layer where Mission solves the problem.

Spec and prompt systems improve the agent's instructions. Mission adds an operating layer around the agent.

## The Short Version

| Tool shape | Typical center | Mission difference |
| --- | --- | --- |
| Prompt templates | better initial instructions | Mission owns runtime state and gates |
| Spec generators | better planning documents | Mission turns artifacts into executable workflow law |
| Agent chats | one interactive session | Mission splits work into bounded Agent sessions |
| CLI task runners | scripted automation | Mission keeps daemon state, worktrees, and command views |

Mission does not compete by being a better model. It coordinates models, repositories, artifacts, and operators under one governed Mission flow.

## What Mission Adds

| Dimension | Prompt/spec tools | Mission |
| --- | --- | --- |
| Workflow authority | The agent follows written instructions | The daemon enforces workflow state and legal commands |
| State | Chat history and markdown files | Repository control state, Mission runtime data, and Entity records |
| Execution safety | Often the active checkout | Isolated Mission worktrees |
| Recovery | Re-read docs and reconstruct context | Reconnect to persisted daemon-owned Mission state |
| Human control | Correct the agent through more chat | Pause, stop, relaunch, rework, verify, and deliver through operator commands |

## Why That Matters

Mission agrees with the core insight behind the other tools: raw improvised chat is not a reliable way to ship software. Where it diverges is in saying that the workflow itself should have an operating system.

That gives teams a durable control boundary around the whole Mission, not just better prompts inside one session. The selected coding agent still does the work. Mission decides what work exists, when it can run, where it runs, what evidence is required, and how the operator stays in control.

Choose Mission when the real problem is not just better prompting, but controlling AI delivery as an observable, recoverable, operator-run system.
