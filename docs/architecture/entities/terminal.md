---
layout: default
title: Terminal Entity
parent: Entity Reference
nav_order: 9
---

# Terminal Entity

`Terminal` is a daemon-addressable PTY-backed terminal transport. It can be attached to an AgentExecution, but it is not the AgentExecution and does not own AgentExecution lifecycle.

## Contract

- Class: `packages/core/src/entities/Terminal/Terminal.ts`
- Schema: `packages/core/src/entities/Terminal/TerminalSchema.ts`
- Contract: `packages/core/src/entities/Terminal/TerminalContract.ts`

## Owns

- Terminal identity and screen snapshot behavior.
- Terminal input, resize, and terminal update publication.
- TerminalRegistry live terminal state.
- Raw terminal recording as transport evidence.

## Does Not Own

- AgentExecution process lifecycle.
- AgentExecution semantic state.
- Mission workflow state.

## Relationships

- May be attached to an AgentExecution as optional transport.
- Produces terminal snapshots and terminal recording events.
