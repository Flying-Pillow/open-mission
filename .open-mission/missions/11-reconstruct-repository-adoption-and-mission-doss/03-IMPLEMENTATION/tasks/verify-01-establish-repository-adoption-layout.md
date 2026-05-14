---
dependsOn:
  - "implementation/01-establish-repository-adoption-layout"
agent: "copilot-cli"
---

# Verify Repository Adoption Layout

Verify that the repository-bound Mission layout is coherent. Check that mission dossiers resolve at `.mission/missions/<mission-id>/`, that `BRIEF.md` and `mission.json` resolve at the mission root, and that root-level stage folders use the canonical names. Confirm the relevant focused tests or adapter-level validations cover this slice, and record any gaps in VERIFY.md.

Use the product artifacts in this mission folder as the canonical context boundary.
