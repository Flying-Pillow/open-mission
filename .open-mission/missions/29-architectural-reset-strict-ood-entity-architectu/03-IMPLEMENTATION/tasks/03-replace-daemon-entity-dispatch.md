---
taskKind: "implementation"
pairedTaskId: "implementation/03-replace-daemon-entity-dispatch-verify"
dependsOn: ["implementation/02-make-repository-domain-authoritative-verify"]
agent: "copilot-cli"
---

# Replace Daemon Entity Dispatch

Objective: replace dynamic daemon entity dispatch with explicit Repository dispatch.

Context: read SPEC daemon dispatch rules, `packages/core/src/daemon/entityRemote.ts`, `runDaemonMain.ts`, protocol contracts, and Repository schema maps.

Allowed files: daemon entity dispatch, daemon protocol contract/version files, direct schema result maps, and focused daemon/core tests.

Forbidden files: Airport client mirror cleanup, route-local remote removal, package export cleanup, and workflow-engine structured runtime records.

Expected change: no `ENTITY_MODELS`, class/prototype probing, arbitrary method execution, generic result normalization, silent null conversion, or fallback path resolution. Repository handlers parse payloads and results and fail loudly.

Compatibility policy: no compatibility dispatcher.

Validation gate: focused daemon/entity dispatch tests, then `pnpm --filter @flying-pillow/mission-core check`.
