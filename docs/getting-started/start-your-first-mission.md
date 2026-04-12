---
layout: default
title: Start Your First Mission
parent: Getting Started
nav_order: 3
---

# Start Your First Mission

Once Mission is installed, the next step is not “let the agent code.” The next step is to start a mission with bounded intent.

If the repository is already Mission-enabled, Mission will use that existing control state. If the current checkout is not initialized yet, the first mission can still bootstrap repository control inside the new mission worktree as part of mission preparation.

Mission supports two intake paths in the current codebase:

- start from a new brief
- start from an existing GitHub issue

Both paths end in the same place: a mission workspace, a dossier of artifacts, and a staged workflow that Mission can monitor and steer through the Airport layout.

## Choose Your Intake Path

### Start From A Brief

This is the right path when the work exists only in your head, in a meeting note, or in a rough product outline.

In the current control surface, Mission can prepare a mission from a brief by collecting:

- mission type
- title
- body

If the brief is not already tied to an issue number, the GitHub-backed preparation flow reconciles that by creating an issue first. Mission then uses the reconciled issue as the tracked mission intake.

### Start From An Existing Issue

This is the right path when the backlog already contains the work.

Mission can prepare a mission from an existing GitHub issue number, fetch the issue details, and create a mission directly from that source. In the discovery surface, issue browsing is only enabled when repository GitHub configuration and GitHub authentication are both ready.

## What Mission Creates For You

After intake, Mission prepares a bounded execution environment instead of pushing the agent straight into your main checkout.

You should expect these results:

| Result | Why it matters |
| --- | --- |
| A mission id and branch reference | Gives the work a stable operational identity |
| An isolated mission workspace | Keeps agent activity away from the primary checkout |
| A mission dossier | Stores `BRIEF.md`, `mission.json`, stage artifacts, and generated task files |
| `mission.json` | Persists runtime state so the mission survives reconnects and restarts |

The tracked dossier lives at `.mission/missions/<mission-id>/` inside the mission worktree. `BRIEF.md` and `mission.json` live at that mission root, and stage artifacts live under root-level stage folders such as `01-PRD/` and `02-SPEC/`.

At a high level, a prepared mission ends up with:

- the original `BRIEF.md`
- `01-PRD/PRD.md`
- `02-SPEC/SPEC.md`
- `03-IMPLEMENTATION/VERIFY.md`
- `04-AUDIT/AUDIT.md`
- `05-DELIVERY/DELIVERY.md`

Those artifacts do not all appear fully populated at once, but that is the dossier shape Mission is steering toward.

## What You See In Mission Next

The Airport layout changes emphasis depending on where you open it:

- opening from the repository checkout opens repository mode
- opening from a mission workspace auto-selects that mission and opens mission mode

Once a mission is selected, the Tower becomes the left-side control surface inside the Airport layout for:

- stage progress
- task readiness and blockage
- live agent sessions
- artifact focus
- mission actions such as pause, resume, panic, and deliver

## What Happens After Start

A well-run first mission usually looks like this:

1. Review the brief to make sure the mission intake is correct.
2. Let Mission drive the PRD and SPEC stages so the work is bounded before coding starts.
3. Inspect the implementation plan and generated tasks.
4. Launch implementation work deliberately.
5. Review verification evidence in `VERIFY.md`.
6. Complete audit and delivery instead of treating them as optional cleanup.

The important idea is that Mission wants you to stay in control of the transition from “problem statement” to “trusted delivery,” not just the coding part in the middle.

## Current Alpha Constraints

The current implementation has a few honest boundaries:

- issue-backed intake is GitHub-specific today
- the public CLI does not yet expose a polished top-level `mission start` command
- the live intake flow exists through the daemon and Mission terminal control surfaces rather than a broad CLI wizard

That does not reduce the value of the workflow. It simply means the product direction is ahead of the final operator polish in some areas.

## Recommended Next Read

[Mission Lifecycle](../core-workflows/mission-lifecycle.md) is the best next page if you want to understand what each stage is for and what artifacts it produces.