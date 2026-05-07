---
dependsOn: ["spec/01-spec-from-prd"]
agent: "copilot-cli"
---

# Plan Implementation And Verification

Read .mission/missions/31-adopt-sandcastle-agentprovideradapter-for-four-a/02-SPEC/SPEC.md and generate paired task markdown under .mission/missions/31-adopt-sandcastle-agentprovideradapter-for-four-a/03-IMPLEMENTATION/tasks. Each slice gets one implementation task and one "-verify.md" task that depends on it. Set `taskKind` and `pairedTaskId` in frontmatter. Do not create production code, delivery artifacts, or workflow-engine structured runtime data.

Implementation tasks must state objective, context, allowed files, forbidden files, expected change, compatibility policy, and validation gate.

Verification tasks must state paired task, focused checks, failure signals, ignored baseline failures, and evidence location. They must not add features.

Keep slices small and dependency ordered. Prefer one boundary or responsibility per task.

Only create or update task markdown. The workflow engine owns structured runtime records.
