# Mission VS Code Extension

This package provides the Mission VS Code cockpit and mission explorer.

## Current Scope

The extension is a Mission cockpit surface backed by the Mission sidecar server.

- It resolves mission state from the governed mission model.
- It contributes the Mission activity-bar container with Flight Controller Cockpit and Mission Explorer views.
- It can run approved mission actions (artifact preparation, checkpoint approvals, stage transitions, gate previews, mission chat launch).
- It does not redefine workflow law; legality remains in core and server mission logic.

## Commands

- `Mission: Show Status`
- `Mission: Refresh Mission Status`
- `Mission: Check Mission Implementation Gate`

## UI Surface

- Activity bar container: `Mission`
- Webview: `Flight Controller Cockpit`
- Tree view: `Mission Explorer`
- Title actions: refresh, settings, status, transition, launch agent
- Tree items and cockpit actions open mission folders/docs and route actions through server-backed operators

## Local Run And Package

- Launch config: `.vscode/launch.json` for an Extension Development Host from the extension package folder
- Build task: `.vscode/tasks.json`
- Watch task: `.vscode/tasks.json` with a background TypeScript watcher for continuous rebuilds into `out/`
- Package script: `pnpm run package`
- Convenience host script: `pnpm run dev:host`
- License file: `LICENSE.txt` so `vsce` packaging does not warn about missing license metadata
- Package allowlist: `files` in `package.json` so `vsce` only ships extension runtime assets

## Workspace Settings

- `mission.rootFolder`: optional explicit operational root folder. Supports `${workspaceFolder}` and `${PWD}`.
- `mission.missionFolder`: mission content folder relative to the operational root. Default: `.mission/worktrees`.
- `mission.skillsFolder`: skills folder relative to the operational root. Default: `.agents/skills`.

Repository workspaces can override these defaults in `.vscode/settings.json`.

## Development

Run the extension typecheck from the repository root:

```sh
pnpm --filter ./apps/vscode-extension run check
```

Run a build when you want extension output in `out/`:

```sh
pnpm --filter ./apps/vscode-extension run build
```

Run a watcher when you want automatic rebuilds into `out/` while debugging:

```sh
pnpm --filter ./apps/vscode-extension run watch
```

The Extension Development Host still needs a window reload to pick up extension runtime changes; VS Code extensions do not support web-style HMR.
