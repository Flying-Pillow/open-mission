---
taskKind: "verification"
pairedTaskId: "implementation/06-tighten-exports-and-remove-transitional-layers"
dependsOn: ["implementation/06-tighten-exports-and-remove-transitional-layers"]
agent: "copilot-cli"
---

# Verify Exports And Removed Transitional Layers

Paired task: `implementation/06-tighten-exports-and-remove-transitional-layers`.

Focused checks: package export map, public barrels, browser imports, removed Repository remotes, `DaemonGateway`, manual parsers, package build/check, and import-boundary scan.

Failure signals: wildcard export, public deep entity remote export, browser shared-schema import from `airport/runtime`, route-specific Repository remote behavior, fallback alias, or normalization layer.

Ignore: unrelated baseline failures not caused by export/import cleanup.

Evidence: append final Repository-first evidence to `03-IMPLEMENTATION/VERIFY.md`. Do not add features.
