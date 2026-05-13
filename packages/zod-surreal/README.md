# zod-surreal

[![Zod](https://img.shields.io/badge/Zod-4-3068B7?style=for-the-badge&logo=zod&logoColor=white)](https://zod.dev)
[![SurrealDB](https://img.shields.io/badge/SurrealDB-3-FF00A0?style=for-the-badge&logo=surrealdb&logoColor=white)](https://surrealdb.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[![CI](https://github.com/Flying-Pillow/mission/actions/workflows/ci.yml/badge.svg)](https://github.com/Flying-Pillow/mission/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@flying-pillow/zod-surreal?label=npm)](https://www.npmjs.com/package/@flying-pillow/zod-surreal)
[![source](https://img.shields.io/badge/source-monorepo-222222?logo=github)](https://github.com/Flying-Pillow/mission/tree/main/packages/zod-surreal)

`@flying-pillow/zod-surreal` is a Zod-first SurrealDB modeling package. It lets TypeScript applications keep Zod schemas as the source of truth, attach SurrealDB metadata through Zod registries, compile deterministic schema snapshots, and render SurrealQL provisioning statements.

```text
Zod schemas + zod-surreal metadata
  -> compiled model snapshot
  -> deterministic SurrealQL DDL
  -> typed query and hydration primitives
```

The database is not the canonical model. SurrealDB inspection and diffing can become useful drift tooling later, but application-owned Zod schemas remain the source of truth.

## Status

This package is ready for **alpha publication**. The package builds, typechecks, has fixture-backed tests, and is wired into the workspace Changesets release flow.

It is not a 1.0 API yet. The current alpha is meant for real integration work while the public API settles around table metadata, field metadata, DDL generation, query helpers, and SurrealDB provisioning ergonomics.

## Install

```bash
pnpm add @flying-pillow/zod-surreal zod
```

`zod` is a runtime dependency today so the package works out of the box in alpha releases. A future stable release may revisit peer dependency shape if downstream package managers need stricter control.

## Technology

- **Zod v4** registries for table and field metadata.
- **SurrealDB and SurrealQL** for generated table, field, analyzer, and index definitions.
- **TypeScript ESM** with declaration output.
- **Vitest** fixture tests, including an official SurrealDB example schema comparison.
- **Changesets** for alpha versioning and npm publication.

## Current Surface

- `table` and `field` Zod registries for SurrealDB metadata.
- `defineModel(...)` for named model definitions.
- `compileSchema(...)` for deterministic schema snapshots.
- `compileDdlPlan(...)` for scoped DDL plans, pruning, `OVERWRITE`, analyzers, and configured implicit full-text indexes.
- `compileDefineStatements(...)` for direct SurrealQL `DEFINE` statement rendering.
- `compileSelectQuery(...)` for parameterized `SELECT` queries with bindings.
- `InMemorySchemaSource` for normalized compiler inputs.

## Quick Start

```ts
import { z } from 'zod/v4';
import { compileDefineStatements, compileSchema, defineModel, field, table } from '@flying-pillow/zod-surreal';

const AuthorSchema = z.object({
  name: z.string().register(field, { type: 'string', searchable: true })
}).strict().register(table, {
  table: 'author',
  schemafull: true
});

const ArticleSchema = z.object({
  title: z.string().register(field, { type: 'string', index: 'normal' }),
  author: z.string().register(field, { reference: 'Author', onDelete: 'cascade' })
}).strict().register(table, {
  table: 'article',
  schemafull: true
});

const snapshot = compileSchema({
  models: [
    defineModel({ name: 'Article', schema: ArticleSchema }),
    defineModel({ name: 'Author', schema: AuthorSchema })
  ]
});

const statements = compileDefineStatements(snapshot, {
  overwrite: true,
  analyzers: [
    {
      name: 'default_text_analyzer',
      tokenizers: ['class', 'punct'],
      filters: ['lowercase', 'ascii', 'snowball(dutch)']
    }
  ]
});

console.log(statements.join('\n'));
```

Output:

```surql
DEFINE ANALYZER OVERWRITE default_text_analyzer TOKENIZERS class, punct FILTERS lowercase, ascii, snowball(dutch);
DEFINE TABLE OVERWRITE article TYPE NORMAL SCHEMAFULL;
DEFINE FIELD OVERWRITE author ON TABLE article TYPE record<author> REFERENCE ON DELETE CASCADE;
DEFINE FIELD OVERWRITE title ON TABLE article TYPE string;
DEFINE INDEX OVERWRITE article_title_idx ON TABLE article FIELDS title;
DEFINE TABLE OVERWRITE author TYPE NORMAL SCHEMAFULL;
DEFINE FIELD OVERWRITE name ON TABLE author TYPE string;
DEFINE INDEX OVERWRITE author_name_ft_idx ON TABLE author FIELDS name FULLTEXT ANALYZER default_text_analyzer BM25(1.2,0.75) HIGHLIGHTS;
```

## DDL Features

The DDL compiler currently supports:

- normal and relation tables
- `SCHEMAFULL`, `SCHEMALESS`, and omitted schema mode
- `AS`, `PERMISSIONS`, comments, computed fields, values, defaults, assertions, readonly fields, and flexible fields
- record references resolved by model name or table name
- `REFERENCE ON DELETE` policies
- normal, unique, full-text, and HNSW vector indexes
- table-level indexes and analyzers
- nested object field index metadata
- scoped plans and stale field/index pruning
- opt-in `OVERWRITE` rendering for provisioning flows

## Official Fixture

The package includes a Surreal Deal Store Mini v3 example under `examples/surreal-deal-store`. The test suite compares generated DDL from Zod schemas against the official SurrealDB schema fixture after statement normalization.

Refresh the generated fixture from the workspace root:

```bash
pnpm --filter @flying-pillow/zod-surreal generate:surreal-deal-store
```

## Development

```bash
pnpm --filter @flying-pillow/zod-surreal check
pnpm --filter @flying-pillow/zod-surreal test
pnpm --filter @flying-pillow/zod-surreal build
```

The package is standalone by design. It must not import Mission packages, Mission entity classes, or Mission workflow vocabulary. Application-specific adapters belong in the application that consumes `@flying-pillow/zod-surreal`.

## Release

The package is published through the workspace Changesets release workflow:

1. Add a changeset for `@flying-pillow/zod-surreal`.
2. CI runs `pnpm run ci:verify` on pull requests.
3. The release workflow runs on `main`, creates a Changesets version PR, and publishes with `NPM_TOKEN` after that PR lands.

The package has public npm publish metadata, an npm `files` allowlist, ESM exports, type declarations, and repository metadata for monorepo publication.

## Repository Strategy

Keep `@flying-pillow/zod-surreal` in this monorepo until the alpha API has been exercised by Mission and at least one non-Mission fixture. That keeps the generic compiler close to the first real consumer while preventing accidental Mission imports through tests and package boundaries.

Split to `Flying-Pillow/zod-surreal` when one of these becomes true:

- the package needs its own issue tracker, release cadence, or contribution guide
- downstream users need a smaller clone and clearer package ownership
- the public API reaches beta stability and changes should be reviewed outside Mission work

Before splitting, carry over the README, examples, tests, Changesets config, npm package provenance, and an explicit license decision.
