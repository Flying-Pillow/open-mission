---
layout: default
title: AI Technical Debt
parent: Core Workflows
nav_order: 2
description: The failure mode Mission is designed to contain.
---

AI coding creates a different kind of technical debt from ordinary codebase entropy. The damage is not only tangled code. It is prompt drift, architectural drift, hidden policy violations, unverifiable output, context rot, and expensive rollback after an agent goes off course.

In [The Elephant in the Room: AI Technical Debt](https://www.youtube.com/watch?v=DgXV8QSlI4U), IBM Distinguished Engineer Jeff Crume describes the pattern as "Ready, Fire, Aim": teams adopt AI workflows for immediate speed, then pay later through instability, leakage, and loss of control.

[![The Elephant in the Room: AI Technical Debt](https://img.youtube.com/vi/DgXV8QSlI4U/hqdefault.jpg)](https://www.youtube.com/watch?v=DgXV8QSlI4U)

IBM's framing explains why fast AI adoption needs governance before the debt compounds.

The same problem appears inside the codebase. In [How To De-Slop A Codebase Ruined By AI (with one skill)](https://www.youtube.com/watch?v=3MP8D-mdheA), Matt Pocock names the repository-level failure mode: AI accelerates software entropy when each local change ignores the shape of the whole system. His answer is design discipline: shared vocabulary, deeper modules, explicit seams, better adapters, and human architectural judgment above the agent.

[![How To De-Slop A Codebase Ruined By AI](https://img.youtube.com/vi/3MP8D-mdheA/hqdefault.jpg)](https://www.youtube.com/watch?v=3MP8D-mdheA)

That talk is a practical view of how AI debt becomes codebase slop when agents outpace architecture and review.

Mission is built to invert that pattern. It treats coding agents as probabilistic workers inside a deterministic operating system. The model may still be non-deterministic; the delivery frame should not be.

## What Mission Changes

| AI debt | Mission response |
| --- | --- |
| Ready, fire, aim | Requirements and specification come before implementation |
| Active branch pollution | Agent work happens in isolated Mission worktrees |
| Context rot | Work is split into bounded tasks and Agent sessions |
| Repeated governance prompting | Repository rules and workflow law are durable control state |
| Agent self-certification | Verification and audit are explicit artifacts and gates |

## Why The Architecture Is Strict

Mission's OOD and Entity rules are not internal neatness for its own sake. They are part of the product answer to AI debt.

When behavior has an owner, state has a schema, commands have contracts, and provider details sit behind adapters, agents have a smaller and clearer world to work inside. That reduces drift. It also gives human reviewers a real place to inspect and correct the system.

Mission does not ask teams to trust AI memory, agent discipline, or terminal scrollback. It gives them staged artifacts, daemon-owned state, isolated worktrees, and operator-visible controls so they can use AI speed without absorbing compounding AI technical debt.
