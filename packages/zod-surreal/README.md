# zod-surreal

`@flying-pillow/zod-surreal` is a Zod-first SurrealDB modeling package.

The package direction is intentionally:

```text
Zod schemas + metadata
  -> compiled model snapshot
  -> SurrealDB DDL/provisioning
  -> typed query and hydration primitives
```

The database is not the canonical model. SurrealDB inspection and diffing can become useful drift tooling later, but domain schemas remain the source of truth.

This package is standalone by design. It must not import Mission packages, Mission entity classes, or Mission workflow vocabulary. Application-specific adapters belong in the application that consumes `@flying-pillow/zod-surreal`.

## Current Surface

- `schema.register(table, metadata)` attaches Surreal table metadata to a Zod object schema.
- `fieldSchema.register(field, metadata)` attaches Surreal field metadata to a Zod field schema.
- `defineModel(...)` declares a named compiled model from input/storage/data schemas.
- `InMemorySchemaSource` provides a normalized schema source for compilers.
- `compileSchema(...)` produces a deterministic model snapshot.
- `compileDefineStatements(...)` renders conservative `DEFINE TABLE` and `DEFINE FIELD` statements.
- `compileSelectQuery(...)` renders parameterized `SELECT` queries with bindings.

## Example

```ts
import { z } from 'zod/v4';
import { compileDefineStatements, compileSchema, defineModel, field, table } from '@flying-pillow/zod-surreal';

const ArticleSchema = z.object({
  title: z.string().register(field, { type: 'string' }),
  author: z.string().register(field, { reference: 'Author' })
}).strict().register(table, {
  table: 'article',
  schemafull: true
});

const snapshot = compileSchema({
  models: [defineModel({ name: 'Article', schema: ArticleSchema })]
});

const statements = compileDefineStatements(snapshot);
```
