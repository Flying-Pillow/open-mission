---
layout: default
title: The Human In The Loop
parent: Core Workflows
nav_order: 4
description: How Mission keeps the operator above automation.
---

Mission treats the human operator as the authority over launch, pause, recovery, and delivery.

The daemon can advertise available Entity commands. Airport can render them. Agent adapters can execute bounded tasks. None of those replace operator judgment at workflow gates.

Operator controls include:

- choosing when to start or resume agent work
- pausing a Mission or task queue
- interrupting an Agent execution
- inspecting artifacts and logs before advancing
- rejecting output and routing follow-up work

Human control is a system property, not a courtesy button in the UI.
