---
layout: default
title: Agent Interaction Structured-First PRD
parent: Architecture
nav_order: 8.9
description: Temporary product requirements for structured-first Agent interaction with optional terminal capability.
---

## Temporary Agent Interaction Structured-First PRD

This temporary PRD captures the product requirements behind ADR-0033. It exists to guide implementation planning while the architecture is still being shaped. When the implementation converges, fold durable language into `CONTEXT.md`, accepted ADRs, and permanent architecture pages, then delete this file.

## Purpose

Mission must let operators work with coding agents through one coherent Mission-owned interaction model while preserving the native terminal affordances developers still value in individual coding CLIs.

The product direction is:

```text
Mission owns meaning.
Agent CLIs may still own native ergonomics.
```

Mission should feel like the operator's primary cockpit for AgentExecution work: prompt delivery, approvals, blocked state, verification, context management, slash-command-like actions, and audit review should be available in Mission UI. The native terminal should remain available when the operator wants provider-specific workflows that Mission has not normalized yet.

## Problem

Current and near-future coding-agent CLIs expose useful native affordances:

- interactive slash commands
- approval and permission prompts
- resume, compact, continue, and status commands
- provider-specific tool displays
- native subagent or planning flows
- provider-specific debugging and login flows

Mission cannot simply discard those features without making the product feel weaker than the underlying CLIs. But Mission also cannot let raw terminal interaction become the source of truth for Mission workflow, context, audit, or Entity state.

Without a structured-first model, Mission risks becoming either:

- a thin terminal wrapper around provider CLIs, or
- a headless-only orchestration layer that loses the developer trust and power-user affordances of native CLIs.

## Goal

Create a structured-first Agent interaction experience where Mission UI is the default control surface and native terminal access remains an optional compatibility/power-user lane.

The operator must be able to:

- start AgentExecutions in structured interactive or structured headless postures.
- send prompts and follow-up instructions through Mission UI.
- discover available actions from the active AgentExecution protocol descriptor.
- use Mission slash commands as shorthand for structured operations.
- inspect Agent progress, blocked state, input requests, verification readiness, and completion claims without reading raw terminal output.
- open an attached terminal when native provider interaction is useful.
- understand whether an action is Mission-native, cross-agent, adapter-scoped, or terminal-only.
- rely on the interaction journal for semantic audit and use terminal recordings for raw evidence.

## Non-Goals

- Do not remove terminal support as part of the first structured-first implementation.
- Do not implement every provider-native slash command as a Mission command.
- Do not make provider-native terminal output the canonical source for workflow or context state.
- Do not create a second chat model outside AgentExecution.
- Do not make MCP tools public automation APIs.
- Do not require every Agent adapter to support MCP before it can run.
- Do not store all stdout/stderr as semantic journal records.

## User Stories

### Developer-Led Execution

As a developer, I can start an AgentExecution from Mission UI, monitor structured progress and input requests, and still open the native terminal when I need a provider-specific command or visual affordance.

### Headless Routine Execution

As an operator, I can run unattended or routine work without a terminal, and the Agent reports progress, needs input, blocked state, verification readiness, and completion through structured Mission signals.

### Slash Command Discovery

As an operator, I can type `/` in Mission UI and see commands that are actually available for this AgentExecution, with clear labels for Mission-native, cross-agent, and adapter-scoped actions.

### Audit Review

As a maintainer, I can review what Mission accepted as semantic truth separately from raw terminal evidence, provider output, or PTY recordings.

### Adapter Evolution

As an adapter maintainer, I can expose a provider-specific command without forcing it into Mission's canonical vocabulary before it is stable or portable.

## Product Principles

### Structured First

Operator intent enters Mission as structured AgentExecution messages, Entity commands, or semantic operations. The terminal may receive delivery attempts, but terminal text does not become canonical intent by default.

### Native When Useful

Terminal access remains available for provider-native workflows, debugging, login flows, and transitional adapter capabilities.

### Descriptor-Driven UI

Mission UI renders actions from descriptors. Surfaces do not hardcode provider commands or infer capabilities from adapter ids.

### Portable Before Provider-Specific

Mission should normalize high-value portable intents first. Provider-specific commands are supported through adapter-scoped descriptors or terminal fallback.

### Semantic Journal, Raw Evidence

The AgentExecution interaction journal records accepted meaning. Raw output remains transport evidence unless promoted into structured observations or runtime facts.

## Requirements

### R1: Execution Posture Visibility

Every live AgentExecution snapshot must expose enough information for Open Mission to tell whether the execution is structured interactive, structured headless, or native terminal escape hatch.

### R2: Descriptor-Backed Commands

Mission UI must render AgentExecution actions from runtime message descriptors and Entity command descriptors, not from hardcoded adapter-specific branches.

### R3: Mission Slash Commands

Mission UI must support slash-command syntax for Mission-native operations. The parser must produce structured command invocations, not raw terminal text.

### R4: Adapter-Scoped Commands

AgentAdapters may advertise adapter-scoped runtime message descriptors. Mission UI must label them as adapter-scoped or non-portable.

### R5: Terminal Fallback

When an adapter supports terminal attachment, the operator may open the terminal and send raw terminal input. Mission must treat that input as transport evidence unless separately accepted through a structured path.

### R6: Journal Separation

Semantic AgentExecution records and raw terminal/provider evidence must remain separate in storage, replay, and UI framing.

### R7: Headless Viability

Structured headless execution must support progress, status, needs input, blocked, ready for verification, completed claim, failed claim, and canonical operator-facing message observations.

### R8: Progressive Normalization

The system must allow a terminal-only or adapter-scoped command to later become a Mission-native or cross-agent command without preserving parallel old/new command names indefinitely.

## Acceptance Criteria

- A new ADR records structured-first, terminal-capable Agent interaction as accepted architecture.
- A temporary SPEC defines command categories, execution postures, descriptor ownership, journaling rules, and migration phases.
- Future implementation tasks can be derived without asking whether terminal or headless interaction is canonical.
- The architecture preserves current terminal-capable adapters while defining a path toward richer Mission UI command coverage.
