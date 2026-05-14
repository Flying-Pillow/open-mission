---
dependsOn:
  - "implementation/01-establish-repository-adoption-layout"
agent: "copilot-cli"
---

# Enable First-Mission Bootstrap

Implement the repository-adoption bootstrap flow so a repository can become Mission-enabled from the mission branch worktree without requiring a separate bootstrap PR or dirtying the original checkout first. This slice should cover repository settings initialization in the mission worktree and the contract that the first mission branch may contain both repository bootstrap content and the first mission dossier.

Use the product artifacts in this mission folder as the canonical context boundary.
