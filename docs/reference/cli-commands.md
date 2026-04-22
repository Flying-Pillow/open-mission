---
layout: default
title: CLI Commands
parent: Reference
nav_order: 1
---

# CLI Commands

This page documents the public Mission CLI surface as it is actually routed today. The source of truth is the published CLI package in `packages/mission`.

## Public Commands

The current public command surface is:

| Command | Status | What it does |
| --- | --- | --- |
| `mission` | Public | Opens the native Airport host |
| `mission native:dev` | Public | Starts the native Airport host in development mode |
| `mission native:build` | Public | Builds the native Airport host |
| `mission install` | Public | Runs user-level Mission setup and writes operator config |
| `mission airport:status` | Public | Prints daemon airport status, or JSON with `--json` |
| `mission daemon:stop` | Public | Stops the daemon process and reports the result |
| `mission help` | Public | Prints the supported surface and notes |
| `missiond` | Public bin | Starts, stops, inspects, or runs the daemon process |

The package is published as `@flying-pillow/mission`.

One-shot use:

```bash
npx @flying-pillow/mission
```

Global install:

```bash
npm install -g @flying-pillow/mission
mission
missiond status
```

## `mission`

```bash
mission
```

Behavior verified in the current CLI package:

- runs the installation guard before the native Airport host starts
- opens the native Airport host by default
- auto-starts the daemon when needed
- auto-selects a mission when opened from a mission worktree
- opens repository mode when opened from the repository checkout
- expects the repository checkout to be using pnpm on Node 24 before launching the native host

## `mission native:dev`

```bash
mission native:dev
```

Starts the native Tauri Airport host in development mode.

## `mission native:build`

```bash
mission native:build
```

Builds the native Tauri Airport host.

## `mission install`

```bash
mission install [--json]
```

This command performs user-level setup:

- ensures Mission config exists
- ensures the mission workspace root exists
- provisions or validates the managed GitHub CLI when the default `gh` command is unavailable

With `--json`, it prints the config path, the effective config object, the resolved missions path, and the managed runtime path.

## `mission airport:status`

```bash
mission airport:status [--json]
```

This command connects to the daemon and reports airport control-plane state, including:

- active airport identity
- pane bindings
- connected clients
- substrate pane state
- known repository airports
- focus intent and observed focus

## `mission daemon:stop`

```bash
mission daemon:stop [--json]
```

This command stops the daemon process using the current manifest and reports whether a process was killed, which socket was involved, and whether the daemon was already stopped.

## `missiond`

```bash
missiond [start|stop|restart|status|run] [--json] [--socket <path>]
```

This bin is shipped by the same `@flying-pillow/mission` package and delegates to the daemon runtime package. It is the direct process-control entry for:

- starting the daemon in the background
- stopping the daemon
- restarting it
- checking status
- running it in the foreground

## About `mission init`

There is a `runInit` implementation in source, but the router does not expose `mission init` as a supported public command. It should therefore be treated as internal or legacy scaffolding code rather than as current public CLI.

That distinction matters because repository adoption is currently exposed through Airport control actions, not through a direct repo-mutating CLI init. In practice, `/init` in the Airport command surface prepares the first initialization mission worktree and lets repository scaffolding be reviewed as normal mission work.
