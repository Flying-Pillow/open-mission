---
dependsOn:
  - "implementation/01-establish-repository-adoption-layout"
  - "implementation/02-enable-first-mission-bootstrap"
agent: "copilot-cli"
---

# Support Repository Modes And Routing

Implement the repository-adoption mode and routing contract described by the brief and PRD. This slice should support both tracked shared `.mission/` usage and local-only gitignored `.mission/` usage, keep the registered repository list minimal and machine-local, and make repository switching semantics coherent around `/repo` and `/add-repo` rather than per-repository command variants.

Use the product artifacts in this mission folder as the canonical context boundary.
