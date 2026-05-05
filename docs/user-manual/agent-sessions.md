---
layout: default
title: Agents, Runtimes, and Models
parent: User Manual
nav_order: 3
description: How Mission attaches agent execution to governed work.
---

An Agent session is daemon-managed execution attached to a Mission, usually focused on one Mission task.

The selected Agent runtime receives bounded context: task instructions, relevant artifacts, and structured Agent session messages. Runtime delivery is best effort; it is not proof that the model understood or completed the work.

Mission keeps runtime choice separate from workflow law. Copilot CLI, pi, and future runtimes can sit behind the same Mission control model when their adapters implement the required contract.
