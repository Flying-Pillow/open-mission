---
layout: default
title: Installation
parent: Getting Started
nav_order: 1
---

# Installation

Mission installation is about preparing your machine to run the published Mission CLI and Airport host. It is not yet about adopting a specific repository or starting a specific mission.

Mission separates setup into two layers:

- user-level setup for the machine that will run the Mission CLI and Airport host
- repository-level setup for each Git checkout you want Mission to manage

This page covers the first layer only.

## Install Mission

You can run Mission directly from npm:

```bash
npx @flying-pillow/mission
```

If you want persistent `mission` and `missiond` commands, install the package globally:

```bash
npm install -g @flying-pillow/mission
```

Then run the installer:

```bash
mission install
```

That prepares the operator environment without opening the full Airport layout.

## What The Installer Sets Up

The current installer prepares the things Mission needs in order to feel smooth on first run:

| Area | What Mission sets up |
| --- | --- |
| Operator config | Creates the Mission config file |
| Mission workspace root | Chooses where isolated mission workspaces and worktrees will live |
| Terminal runtime | Provisions or validates the configured terminal multiplexer used to host agent sessions |
| GitHub integration | Provisions or validates the Mission-managed GitHub CLI when the default `gh` command is unavailable |

In the current implementation, the Mission config is written to the usual XDG config location when available, otherwise under `~/.config/mission/config.json`. On supported Linux systems, Mission stores its managed runtime envelope under `~/.config/mission/runtime`.

## What Mission Expects On Your Machine

These current runtime facts matter:

| Requirement | Why it matters |
| --- | --- |
| Node.js 24 | Required for the workspace, the published Mission CLI, and the native Airport host toolchain |
| pnpm 10 | Required as the workspace package manager; enable it through Corepack |
| A PTY-capable Linux environment | Mission agent sessions run through the daemon-backed PTY transport, which requires the host to support pseudoterminals |
| GitHub CLI | Used for Mission's GitHub-backed flows and provisioned by Mission on supported Linux systems when `gh` is missing |
| The daemon | Auto-started by the Airport layout when needed |

On Linux, Mission installs the managed GitHub CLI runtime into its own runtime directory instead of relying on whatever happens to be in the general user bin path.

## Your First Run

For most operators, the first good run looks like this:

```bash
npm install -g @flying-pillow/mission
mission install
mission
```

What happens next:

1. Mission validates the operator setup.
2. Mission provisions or repairs the managed GitHub CLI runtime when the default `gh` command is unavailable.
3. Mission opens the Airport host.
4. The daemon starts automatically if it is not already running.
5. If repository control state is missing, Mission can scaffold it on the way in.

## Why The Setup Matters

The goal is not to make installation complicated. The goal is to make operation predictable.

Once installation is done:

- your mission workspaces have a known home
- the agent session transport can attach directly to daemon-owned PTYs without a required external multiplexer
- the Airport host can rely on a pnpm workspace running on Node 24
- reconnecting to Mission feels consistent across repositories

That is part of the product promise: Mission should feel like a real operations tool, not a pile of one-off scripts.

## What This Page Does Not Cover

This page does not adopt a repository and does not start a mission.

Those come next:

- [Repository Setup](repository-setup.md)
- [Start Your First Mission](start-your-first-mission.md)
