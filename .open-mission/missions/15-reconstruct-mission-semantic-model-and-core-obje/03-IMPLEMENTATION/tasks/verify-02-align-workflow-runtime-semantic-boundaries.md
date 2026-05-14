---
dependsOn: ["implementation/02-align-workflow-runtime-semantic-boundaries"]
agent: "copilot-cli"
---

# Verify Workflow Runtime Semantic Boundaries

Verify that mutable workflow truth remains mission-local and that runtime projections are still derived from workflow events rather than ad hoc filesystem or daemon-wide state. Confirm the relevant workflow-engine and mission runtime tests cover these ownership boundaries, and record any remaining semantic-boundary gaps in VERIFY.md.

Use the product artifacts in this mission folder as the canonical context boundary.
