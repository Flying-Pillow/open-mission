---
layout: default
title: Airport Layout Overview
parent: User Manual
nav_order: 1
---

# Airport Layout Overview

The Airport layout is the operator's cockpit for Mission.

It is where you move from “I have work to do” to “I can see the mission, the stage, the tasks, the artifacts, and the live agent session that is doing the work.”

## What You See When Mission Opens

On a normal POSIX setup, Mission can bootstrap an airport-style layout with three coordinated surfaces:

- Mission Tower on the left
- Runway on the upper right when a live agent session is selected
- Briefing Room on the lower right

That layout is one of the reasons the product feels usable in practice. You do not have to mentally stitch together a CLI, a text editor, and a random agent terminal. Mission places them into one operating surface.

## Repository Mode And Mission Mode

Tower, as the left-side control surface inside Airport, has two main operating contexts:

| Mode | What it is for |
| --- | --- |
| Repository mode | Repository setup, mission intake, issue browsing, and selection |
| Mission mode | Stage progress, tasks, artifacts, sessions, and mission actions |

Opening from a repository checkout opens repository mode. Opening from an existing mission workspace automatically selects that mission and opens mission mode.

That is a good product detail because it means the surface adapts to where you are in the workflow instead of making every screen feel the same.

## The Main Airport Regions

The current Airport layout is built around three outer regions, with Tower itself built around four inner regions.

Outer layout:

1. Tower
2. Runway
3. Briefing Room

Tower shell:

1. Header
2. Center panel
3. Command panel
4. Key hints row

### Header

The header gives you fast situational awareness:

- current repository or mission context
- stage rail
- status badges and summary context

When you are in mission mode, the stage rail is the quickest way to understand where the mission is and what still needs attention.

### Center Panel

The center panel is the main work surface.

In repository mode, it is where Mission can drive repository and intake flows. In mission mode, it becomes the mission view for stages, tasks, artifacts, and sessions.

Internally, that mission view is being organized so the mission-control feature owns the projection of daemon context into tree rows and session/task displays, instead of keeping those transforms in the top-level Tower shell.

### Command Panel

The command panel is the stable operator control surface. This is where Mission exposes available actions and confirmation flows instead of forcing you to remember fragile shell commands.

In Tower, the panel name is historical UI language. The important distinction is:

- an **action** is the daemon-owned operation Mission says is available right now
- a **command** is the way Tower lets you pick or type that action

If you type `/mission resume`, you are not creating a new business operation in the terminal. You are selecting the daemon action whose action text is `/mission resume`.

Internally, the command surface is being organized so command-specific view models and interaction rules are owned by the command feature rather than the top-level shell. That keeps the command panel focused on rendering while the command feature owns the local UI logic.

### Key Hints Row

The bottom hint row keeps interaction discoverable. That matters in a terminal product because the UI has to stay fast without becoming obscure.

## Why The Airport Layout Matters

Mission is not only a workflow engine. It is a supervised operations product.

The Airport layout is how that supervision becomes practical, with Tower as the control surface and Runway and Briefing Room as the execution companions:

- you can see what stage is active
- you can inspect which task is ready or blocked
- you can open the live session that is doing work
- you can keep the editor next to the agent instead of in a separate universe

This is a big part of why Mission is compelling. It makes AI-assisted delivery feel governable instead of chaotic.