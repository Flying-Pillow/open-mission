---
agent: "copilot-cli"
---

# Establish Repository Adoption Layout

Implement the repository-owned Mission layout so tracked repository state lives under `.mission/` and each mission dossier lives directly under `.mission/missions/<mission-id>/`. This slice should establish the canonical filesystem contract for the repository-bound Mission namespace, the mission dossier root, root-level `BRIEF.md`, root-level `mission.json`, and canonical stage-folder paths.

Use the product artifacts in this mission folder as the canonical context boundary.
