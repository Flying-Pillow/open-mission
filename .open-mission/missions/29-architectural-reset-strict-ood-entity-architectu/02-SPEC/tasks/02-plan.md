---
dependsOn: ["spec/01-spec-from-prd"]
agent: "copilot"
---

# Plan Implementation And Verification

Read SPEC.md and turn it into an execution ledger. Create paired markdown task files under 03-IMPLEMENTATION/tasks for each implementation slice: one task for building the slice and a second verification task for testing or validating that same slice. Name the verification task with the "-verify.md" suffix, keep both tasks in 03-IMPLEMENTATION/tasks, and make the verification task depend on its implementation task. The verification task must focus on tests and validation rather than feature creation. Do not create application code in this planning task. Do not modify delivery artifacts.
