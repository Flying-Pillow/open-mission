# Surreal Deal Store Example

This example mirrors the schema portion of SurrealDB's official Surreal Deal Store Mini v3 dataset.

Source dataset URL:

```text
https://datasets.surrealdb.com/datasets/surreal-deal-store/mini-v3.surql
```

The local fixture keeps the official `DEFINE TABLE`, `DEFINE FIELD`, `DEFINE INDEX`, and `DEFINE ANALYZER` statements only. It intentionally omits users, functions, and table data so the example can compare `zod-surreal` DDL output against the public schema without vendoring the whole dataset export.
