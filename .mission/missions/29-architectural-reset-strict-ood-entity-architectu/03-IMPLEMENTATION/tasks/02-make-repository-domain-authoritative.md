---
taskKind: "implementation"
pairedTaskId: "implementation/02-make-repository-domain-authoritative-verify"
dependsOn: ["implementation/01-create-canonical-schema-contracts-verify"]
agent: "copilot-cli"
---

# Make Repository Domain Authoritative

Objective: make `Repository` and `Repositories` the only Repository domain and collection authorities.

Context: read `02-SPEC/SPEC.md`, then current `packages/core/src/schemas/Repository.ts`, `packages/core/src/entities/Repository/Repository.ts`, and `Repositories.ts`.

Allowed files: Repository entity/collection files, direct Repository helper imports, and focused core tests. Edit schemas only for a task-scoped defect.

Forbidden files: daemon dispatch, Airport web, package exports, SSE/event wiring, and workflow-engine structured runtime records.

Expected change: Repository methods import canonical schemas, return JSON-safe schema-shaped values, reject invalid payloads, and keep `add`, issue queries, and mission-start behavior entity-owned. `RepositorySchema.ts` and `RepositoryRemote.ts` must not own contracts.

Compatibility policy: no fallback, alias, or duplicate contract layer.

Validation gate: focused Repository tests if present, then `pnpm --filter @flying-pillow/mission-core check`.
