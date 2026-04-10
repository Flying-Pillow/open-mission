# Installation

Mission has two distinct setup layers:

- User-level installation, which configures the local machine that will run Tower.
- Repository-level preparation, which creates repo-scoped control state under `.mission/`.

This page covers the user-level path only.

## Install The CLI

Install Mission globally:

```bash
npm install -g @flying-pillow/mission
```

The public entry routes through `mission`. Running `mission install` performs user-level setup without launching the Tower surface.

## What `mission install` Configures Today

`mission install` calls the same installation guard that the Tower uses on startup. In the current codebase it ensures:

| Setting | Purpose | Current behavior |
| --- | --- | --- |
| Mission user config | Stores operator defaults | Written to `$XDG_CONFIG_HOME/mission/config.json` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/mission/config.json` |
| `missionWorkspaceRoot` | Root directory for per-repository mission worktrees | Defaults to `missions`; relative values resolve under the operator home directory |
| `terminalBinary` | Terminal manager used by Mission | Defaults to `zellij`; on Linux Mission can auto-install it into `~/.local/bin` |
| `editorBinary` | Editor launched into the editor gate | Defaults to `micro`; on Linux Mission can auto-install it into `~/.local/bin`, otherwise it falls back to `nano`, `vim`, or `vi` when available |

If the configured workspace root cannot be created, the installer prompts for a writable alternative. If the configured binaries are missing, Mission tries automatic installation for managed dependencies first, then falls back to prompting for a valid command or absolute path.

## Runtime Prerequisites That Are True Right Now

The current runtime has a few important operational constraints:

| Requirement | Status in code |
| --- | --- |
| Bun | Required to launch the OpenTUI Tower surface because the Tower imports `bun:ffi` at runtime |
| Node.js | Still usable for non-Tower CLI commands |
| zellij | Preferred terminal substrate; Mission can auto-install it on Linux |
| Editor binary | Required for the editor gate; configured in user config |
| Daemon | Auto-started when launching Tower if it is not already running |

The first important caveat is that `mission` and `mission install` are not equivalent. `mission install` prepares the operator environment. Bare `mission` still performs the installation guard first, then proceeds into the Tower bootstrap path.

## First-Run Operator Experience

On a clean machine, the current first-run experience is:

1. Install the package globally.
2. Run `mission install` to populate user config and validate binaries.
3. Run `mission` to launch the Tower surface.
4. If the daemon is not running, Tower starts it automatically.
5. If repository control state is missing, Mission scaffolds it before continuing.

On POSIX shells, bare `mission` also attempts to bootstrap the airport layout through the terminal manager when that substrate is available. The current layout places Mission Tower on the left, an agent session pane on the upper right, and the editor gate on the lower right.

## User-Level Setup Versus Repository-Level Setup

Do not conflate these two steps:

- User-level setup writes the operator config and resolves binaries.
- Repository-level setup creates repo-scoped Mission control state such as `.mission/settings.json`.

User-level setup is global to the machine. Repository-level setup is tied to a specific Git checkout. The second step is documented in [Repository Setup](repository-setup.md).

## Practical Guidance

For a predictable first run on Linux:

```bash
npm install -g @flying-pillow/mission
mission install
bun --version
mission
```

If Tower fails to launch but non-Tower commands work, verify Bun first. That is the main runtime distinction enforced by the current bootstrap code.