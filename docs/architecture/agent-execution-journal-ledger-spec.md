---
layout: default
title: Agent Execution Journal Vocabulary Spec
parent: Architecture
nav_order: 8.9
description: Temporary spec for the narrowed AgentExecution journal vocabulary.
---

## Temporary Agent Execution Journal Vocabulary Spec

This temporary spec follows ADR-0006.13 and records the current narrowed AgentExecution journal vocabulary.

The current AgentExecution journal direction is intentionally smaller:

- AgentExecution owns one ordered journal for accepted execution meaning.
- AgentExecutionRegistry only resolves active AgentExecution instances and their live process handles.
- AgentAdapter translates provider launch, delivery, and output.
- Terminal and TerminalRegistry own PTY transport and terminal recordings.
- Raw terminal/provider output is evidence unless accepted through a structured AgentExecution path.
- Semantic operations record bounded daemon-observed AgentExecution observations.

Use ADR-0006.08, ADR-0006.09, ADR-0006.10, and the AgentExecution Entity schemas for current implementation work.
