Prepare this repository for the Mission SPEC driven development cycle.

Repository: {{repository.ref}}
Default branch: {{repository.defaultBranch}}
Local root: {{repository.rootPath}}

This preparation mission should initialize the repository for Mission control without requiring the clean base repository checkout to already contain Mission state.

Expected outcome:

- Create the first Mission worktree for this repository.
- Create `.mission/settings.json` inside the Mission worktree.
- Create `.mission/workflow/workflow.json` inside the Mission worktree.
- Create the repository-owned workflow template preset inside the Mission worktree.
- Keep the base repository checkout clean until Mission changes are deliberately merged back.

Use this issue as the default preparation brief for bringing the repository under the Mission system.
