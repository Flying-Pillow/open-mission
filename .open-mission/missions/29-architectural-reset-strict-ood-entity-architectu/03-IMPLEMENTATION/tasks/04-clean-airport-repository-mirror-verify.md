---
taskKind: "verification"
pairedTaskId: "implementation/04-clean-airport-repository-mirror"
dependsOn: ["implementation/04-clean-airport-repository-mirror"]
agent: "copilot-cli"
---

# Verify Airport Repository Mirror

Paired task: `implementation/04-clean-airport-repository-mirror`.

Focused checks: Repository mirror methods, generic remote dispatch tests, browser imports, route-local Repository remotes, and component payload composition.

Failure signals: browser code imports daemon/node modules, deep entity remote contracts, route-local Repository remotes still own behavior, or components bypass the mirror.

Ignore: unrelated existing Airport web diagnostics outside this slice.

Evidence: append a task-specific section to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
