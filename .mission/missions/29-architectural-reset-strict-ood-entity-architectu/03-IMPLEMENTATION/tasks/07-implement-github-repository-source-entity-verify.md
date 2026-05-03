---
taskKind: "verification"
pairedTaskId: "implementation/07-implement-github-repository-source-entity"
dependsOn: ["implementation/07-implement-github-repository-source-entity"]
agent: "copilot-cli"
---

# Verify GitHub Repository Source Entity

Paired task: `implementation/07-implement-github-repository-source-entity`.

Focused checks: explicit daemon handlers for `GitHubRepository.find` and `GitHubRepository.clone`, canonical schemas under `@flying-pillow/mission-core/schemas`, provider access through `RepositoryPlatformAdapter`, no direct Airport route/component GitHub CLI calls, and no `control.github.repositories.list` dependency in the active UI path.

Failure signals: `GitHubRepository` calls `GitHubPlatformAdapter` directly in target code, daemon dispatch rejects the source entity, Airport imports route-local GitHub remotes, clone does not hydrate a local `RepositorySnapshot`, or the browser panel still shows the minimal-daemon method-not-implemented error.

Ignore: unrelated full `check:web` baseline failures already documented in `04-AUDIT/AUDIT.md`.

Evidence: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md` and record the inline-browser result for `/airport`. Do not add new feature scope beyond source repository discovery/import.
