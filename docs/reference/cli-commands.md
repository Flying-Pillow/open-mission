# CLI Commands

This page documents the public Mission CLI surface as it is actually routed today. The source of truth is `apps/tower/terminal/src/routeTowerEntry.ts` and the help text emitted by that router.

## Public Commands

The current public command surface is:

| Command | Status | What it does |
| --- | --- | --- |
| `mission` | Public | Launches the terminal Tower surface |
| `mission install` | Public | Runs user-level Mission setup and writes operator config |
| `mission airport:status` | Public | Prints daemon airport status, or JSON with `--json` |
| `mission daemon:stop` | Public | Stops the daemon process and reports the result |
| `mission help` | Public | Prints the supported surface and notes |
| `missiond` | Related entry | Starts the daemon process entrypoint |

## `mission`

```bash
mission [--hmr] [--banner] [--no-banner]
```

Behavior verified in the current router and Tower bootstrap:

- runs the installation guard before Tower starts
- launches the Tower surface by default
- auto-starts the daemon when needed
- attempts airport layout bootstrap through the terminal manager on POSIX shells when available
- auto-selects a mission when launched from a mission worktree
- opens repository mode when launched from the repository checkout
- requires Bun for the OpenTUI Tower runtime

Supported Tower flags are currently limited to:

- `--hmr`
- `--banner`
- `--no-banner`

## `mission install`

```bash
mission install [--json]
```

This command performs user-level setup:

- ensures Mission user config exists
- ensures the mission workspace root exists
- resolves or installs the terminal manager binary
- resolves or installs the editor binary

With `--json`, it prints the config path, the effective config object, and the resolved missions path.

## `mission airport:status`

```bash
mission airport:status [--json]
```

This command connects to the daemon and reports airport control-plane state, including:

- active airport identity
- gate bindings
- connected clients
- substrate pane state
- known repository airports
- focus intent and observed focus

## `mission daemon:stop`

```bash
mission daemon:stop [--json]
```

This command stops the daemon process using the current manifest and reports whether a process was killed, which socket was involved, and whether the daemon was already stopped.

## Internal Bootstrap Hooks

The router also contains internal commands used for airport pane bootstrap:

- `__airport-layout-launch__`
- `__airport-layout-editor-pane`
- `__airport-layout-agent-session-pane`

These are implementation hooks for airport layout startup. They are not part of the supported public CLI contract and should not be documented as operator-facing commands.

## About `mission init`

There is a `runInit` implementation in source, but the router does not expose `mission init` as a supported public command. It should therefore be treated as internal or legacy scaffolding code rather than as current public CLI.

That distinction matters because repository bootstrap still exists as a behavior, but it is not currently published through the routed command surface under `mission init`.