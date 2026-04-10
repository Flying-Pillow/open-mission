# Repository Setup

Repository setup in Mission creates repository-scoped control state. It does not create or start a mission workflow by itself.

That distinction matters because Mission uses different storage layers for different concerns:

- Repository control state lives under `.mission/` in the repository checkout.
- Mission worktrees live under the operator's mission workspace root.
- Per-mission runtime state is persisted later as `mission.json` inside an individual mission workspace.

## What Repository Bootstrap Creates

The low-level repository initializer creates the Mission control directory and initializes repository workflow settings. In the current codebase, the relevant paths are:

| Path | Scope | Responsibility |
| --- | --- | --- |
| `.mission/` | Repository-scoped | Root control directory for Mission metadata |
| `.mission/settings.json` | Repository-scoped | Daemon and workflow defaults for this repository |
| `.mission/missions` | Repository-scoped catalog path | Repository-side catalog location referenced by the control layer |
| `<missionWorkspaceRoot>/<repo-name>` | User-scoped worktree root | Root under which Mission creates isolated worktrees for this repository |

The default repository settings file is created through `WorkflowSettingsStore.initialize()`, which writes the repository workflow configuration into `.mission/settings.json`. The default settings include repository workflow defaults, tracking provider defaults, instructions and skills paths, and airport intent data when configured.

## What Repository Bootstrap Does Not Create

Repository bootstrap does not create `mission.json`.

That file is the per-mission workflow runtime record. It belongs to a specific mission execution workspace and is created later by the workflow engine when a mission runtime is materialized. This separation is intentional:

- `.mission/settings.json` describes repository policy and defaults.
- `mission.json` captures runtime execution state for one mission.

The runtime record is described in [Workflow Engine](../architecture/workflow-engine.md) and [State Schema](../reference/state-schema.md).

## Mission Workspace Root And Worktree Behavior

Mission resolves the workspace root from user or repository configuration using `missionWorkspaceRoot`. By default that value is `missions`, which resolves relative to the operator home directory, not the repository checkout.

For a repository rooted at `/repo/example`, the default worktree root is conceptually:

```text
~/missions/example
```

This is where Mission isolates mission execution worktrees. The repository checkout remains the control root. The mission workspace root is a separate operator-owned storage area.

## Repository Bootstrap Versus Mission Runtime

The current codebase draws a clear line between three concepts:

| Concept | Created when | Stored where |
| --- | --- | --- |
| Repository bootstrap | When Mission initializes repository control state | `.mission/` in the repository checkout |
| Mission workspace root | When user config resolves the external worktree root | Typically `~/missions/<repo-name>` |
| Per-mission runtime state | When a mission execution is created and managed by the workflow engine | Mission workspace, including `mission.json` |

This separation is one of Mission's core safety properties. The repository holds durable control settings. Mission execution state is isolated to mission workspaces. Agent work does not need to mutate the primary checkout directly.

## About `mission init`

There is a `runInit` implementation in the terminal source, but the public CLI router does not currently expose `mission init`. It should therefore be treated as an internal or legacy helper, not as the supported operator entrypoint.

From an operator perspective, repository bootstrap is currently reached through the broader Mission startup path and repository preparation services, not through a documented public `mission init` command.

## Repository Preparation Service

The repository preparation flow used by the daemon is stricter than the low-level initializer. It prepares repository scaffolding in a temporary linked worktree, stages `.mission/settings.json`, pushes a branch, and opens a pull request titled `Initialize Mission repository scaffolding`.

That flow is important for governance-minded teams because repository control state is proposed and reviewed like normal source changes. It avoids silently mutating the main branch while still establishing the required Mission control directory and workflow defaults.