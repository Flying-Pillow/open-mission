---
layout: default
title: Mission
nav_title: Overview
nav_order: 1
description: Mission coordinates AI-assisted software delivery through repository-owned workflow law, daemon-owned state, and operator-controlled agent runtimes.
---

Mission is a local-first control system for AI-assisted software delivery. It gives coding agents a governed workflow, isolated workspaces, durable artifacts, and a human operator above the automation.

[Start Here](getting-started/installation.md) · [Start a Mission](getting-started/start-your-first-mission.md) · [Why Mission Exists](core-workflows/ai-technical-debt.md)

| Promise | What it means |
| --- | --- |
| Safe by design | Agent work runs in isolated Mission worktrees instead of your active branch |
| Structured delivery | Work moves from brief to requirements, spec, implementation, verification, audit, and delivery |
| Runtime freedom | Workflow stays stable while agent runtimes remain replaceable adapters |

Mission exists because raw AI coding is fast, but fast is not the same thing as governable. A long chat session can drift from the architecture, rewrite the wrong files, lose context, sound confident without proof, and leave the human trying to reconstruct what happened from terminal scrollback.

Mission turns that into an operation. The Mission owns the workflow, state, artifacts, tasks, and command surface. Agent runtimes execute bounded work underneath that control layer.

The practical promise is simple: use AI speed without giving up architectural discipline, repository safety, or human control.

## How It Works

Instead of one open-ended session working directly on your checkout, Mission gives each unit of work a governed path:

1. adopt a Repository and record its Mission control state
2. start a Mission from a brief or tracked issue
3. create an isolated Mission worktree
4. move through staged artifacts and tasks
5. launch Agent sessions with bounded context
6. verify, audit, and deliver with evidence

Airport is the operator surface for that flow. Tower shows the legal commands, Runway hosts live agent execution, and Briefing Room keeps artifacts in view.

## What Mission Protects

| Risk | Mission response |
| --- | --- |
| Agent work corrupts the main checkout | Work happens in isolated Mission worktrees |
| Context turns into one fragile chat | Work is split into artifacts, stages, tasks, and sessions |
| UI state becomes truth | The daemon owns runtime state and Entity behavior |
| Provider details leak inward | GitHub, Git, and agent runtimes sit behind adapters |
| Verification becomes self-reported | Gates require artifacts and operator-visible evidence |

## Why Teams Use It

Mission is for teams that want agents to move quickly inside a system that still feels like serious engineering. It is useful when you care about:

- protecting the main checkout while agents explore and edit
- keeping requirements, implementation, verification, and audit separate
- making progress recoverable after crashes, restarts, or runtime failures
- keeping humans in charge of launch, pause, stop, rework, and delivery
- preventing provider-specific details from becoming your workflow model

The system is opinionated because the failure mode is real: AI accelerates both good architecture and bad architecture. Mission tries to make the disciplined path the easiest path.

For the broader motivation, read [AI Technical Debt](core-workflows/ai-technical-debt.md), including the IBM and Matt Pocock talks that shaped this framing.

## Core Vocabulary

- **Repository**: the local checked-out Git repository used as the base for Mission work.
- **Mission**: a long-lived unit of engineering work with a brief, workflow state, artifacts, tasks, and agent sessions.
- **Running Mission instance**: the daemon-owned Entity that applies workflow law while a Mission is live.
- **Mission artifact**: a tracked operator-facing file produced or consumed by the Mission.
- **Agent session**: a daemon-managed execution attached to a Mission or Mission task.
- **Airport**: the operator surface for reading and steering the daemon-owned system.

The full domain glossary lives in CONTEXT.md. ADRs explain why the architecture is shaped this way.

## Start Reading

- [Installation](getting-started/installation.md) gets the tooling running.
- [Repository Setup](getting-started/repository-setup.md) explains how a repository becomes Mission-ready.
- [Mission Lifecycle](core-workflows/mission-lifecycle.md) shows how work moves from brief to delivery.
- [Architecture](architecture/index.md) explains the daemon, Entity model, Airport surfaces, and adapters.
- [Architecture Decisions](adr/index.md) records the decisions that constrain future changes.
