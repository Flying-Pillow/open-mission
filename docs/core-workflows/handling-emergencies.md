---
layout: default
title: Handling Emergencies
parent: Core Workflows
nav_order: 5
description: Stop unsafe work and recover deliberately.
---

Use emergency controls when an agent is doing unsafe work, running the wrong command, or producing changes that should not continue.

Pause, stop, and interrupt actions are daemon commands. They target runtime execution and queue state; they do not rewrite history or silently repair artifacts.

After an emergency:

1. inspect the Mission worktree
2. inspect Agent execution logs and artifacts
3. decide whether to resume, replan, or abandon the task
4. record the recovery evidence in the Mission artifacts when it affects delivery readiness

Mission favors visible recovery over hidden cleanup.
