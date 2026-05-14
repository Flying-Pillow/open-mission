---
dependsOn: ["implementation/01-establish-mdsvex-docs-pipeline-and-source-normalization"]
agent: "copilot"
---

# Build Docs Manifest Navigation And Page Resolution

Implement the normalized docs domain model and manifest loader that discover compiled markdown modules under `docs/`, map legacy metadata into typed docs frontmatter, derive deterministic navigation ordering, and resolve `/docs` plus nested slug requests to the correct page entry. This slice should keep route resolution, navigation derivation, and source metadata aligned around one shared manifest instead of duplicating logic across loaders and components.

