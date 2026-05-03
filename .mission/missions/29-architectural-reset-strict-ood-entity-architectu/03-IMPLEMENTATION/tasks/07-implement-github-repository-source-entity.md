---
taskKind: "implementation"
pairedTaskId: "implementation/07-implement-github-repository-source-entity-verify"
dependsOn: ["implementation/06-tighten-exports-and-remove-transitional-layers-verify"]
agent: "copilot-cli"
---

# Implement GitHub Repository Source Entity

Objective: make the Airport GitHub repositories functionality use a first-class `GitHubRepository` source entity backed by the repository platform adapter boundary.

Context: read `02-SPEC/SPEC.md`, especially `GitHub Repositories Assessment`, then inspect `packages/core/src/entities/GitHubRepository`, `packages/core/src/entities/Repository/PlatformAdapter.ts`, `packages/core/src/platforms/GitHubPlatformAdapter.ts`, daemon entity dispatch, and the Airport `GithubRepository` client mirror.

Allowed files: GitHubRepository entity/schema files, repository platform adapter/factory files, daemon entity dispatch, Airport `GithubRepository` mirror, Airport add-repository UI wiring, and focused tests.

Forbidden files: Mission/Stage/Task/Artifact/AgentSession architecture work, broad daemon protocol redesign beyond explicit dispatch support, route-local GitHub remotes, and workflow-engine structured runtime records.

Expected change: `GitHubRepository.find` and `GitHubRepository.clone` route through generic entity query/command remotes and explicit daemon handlers. Backend `GitHubRepository` delegates all provider operations through `RepositoryPlatformAdapter` or its factory, not direct GitHub-specific implementation calls. Clone/import returns a local `RepositorySnapshot` after registration.

Compatibility policy: no route-specific `control.github.repositories.list` fallback and no direct browser/server component access to GitHub CLI behavior.

Validation gate: focused daemon entity dispatch tests for `GitHubRepository`, focused Airport web tests for the client mirror/add-repository flow, and a manual inline-browser check of the GitHub repositories panel.
