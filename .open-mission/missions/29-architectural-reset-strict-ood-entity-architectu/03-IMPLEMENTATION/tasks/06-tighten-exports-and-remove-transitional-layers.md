---
taskKind: "implementation"
pairedTaskId: "implementation/06-tighten-exports-and-remove-transitional-layers-verify"
dependsOn: ["implementation/05-wire-sse-projection-ownership-verify"]
agent: "copilot-cli"
---

# Tighten Exports And Remove Transitional Layers

Objective: remove Repository-first transitional surfaces and tighten public imports.

Context: read SPEC package export contract, `packages/core/package.json`, public barrels, web imports, transitional remotes, `DaemonGateway`, and manual parsers.

Allowed files: package exports/barrels, imports that consume stable entrypoints, transitional Repository remotes, `DaemonGateway`, manual parsers, and focused import-boundary tests.

Forbidden files: new architecture features beyond Repository-first cleanup and workflow-engine structured runtime records.

Expected change: minimal stable exports only; no wildcard exports; no public deep entity remote exports; no browser dependency on `airport/runtime` for shared schemas; route-specific Repository remotes gone; obsolete parsers removed or replaced by shared schemas.

Compatibility policy: no fallback, alias, compatibility, or normalization layer in the target path.

Validation gate: package build/check, focused import-boundary scan, focused web checks relevant to changed imports.
