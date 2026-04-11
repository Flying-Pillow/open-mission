---
layout: default
title: AI Technical Debt
parent: Core Workflows
nav_order: 2
---

# AI Technical Debt and Mission

Integrating large language models into software delivery creates a different kind of technical debt than classic codebase entropy.

Traditional debt tends to show up as tangled code, weak tests, or deferred cleanup. AI technical debt is more operational: prompt drift, architectural drift, hidden policy violations, unverifiable output, context rot, and expensive rollback when an agent goes off the rails.

In his presentation [The Elephant in the Room: AI Technical Debt](https://www.youtube.com/watch?v=04p9X_XpX-Y), IBM Distinguished Engineer Jeff Crume describes the pattern as "Ready, Fire, Aim." Teams ship AI-assisted workflows for immediate speed, then pay later through instability, leakage, and loss of control.

<div class="mission-video-embed">
	<iframe
		src="https://www.youtube-nocookie.com/embed/04p9X_XpX-Y"
		title="The Elephant in the Room: AI Technical Debt"
		loading="lazy"
		referrerpolicy="strict-origin-when-cross-origin"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		allowfullscreen>
	</iframe>
</div>

Mission is built to invert that pattern. It treats coding agents as probabilistic workers inside a deterministic operating system. The model stays non-deterministic. The delivery harness does not.

## 1. The Ready, Fire, Aim Problem

**The debt:** Most AI coding products start with an open-ended chat attached directly to the developer's active branch. That makes it easy to ask for code before the architecture is bounded. Since the model is generating the plan while it generates the implementation, you get improvised structure, invented helpers, and gradual repository drift.

**Mission's approach:** Mission separates planning from execution with a strict stage-gated flow:

```text
PRD -> SPEC -> IMPLEMENTATION -> AUDIT -> DELIVERY
```

- The system requires the `SPEC` stage before application code execution should begin.
- The agent must produce a concrete implementation and verification plan as machine-readable workflow state.
- A human operator or the workflow engine approves progression before implementation is unlocked.

Mission forces the system to aim before it fires.

## 2. Execution and Rollback Debt

**The debt:** In a standard local CLI workflow, a failed autonomous run pollutes the active checkout. A bad 40-file refactor is not only wrong. It is costly to unwind. Developers must inspect Git state, clean residual files, and verify that the rollback itself is trustworthy.

**Mission's approach:** Mission runs work inside isolated Git worktrees tied to the mission.

- The daemon provisions a dedicated mission workspace under `.mission/worktrees/<mission-id>`.
- The agent runner is confined to that boundary instead of the operator's active branch.
- If the run fails, the system can discard the mission workspace without contaminating the primary checkout.

That changes rollback from a forensic exercise into a routine operational control.

## 3. Context Rot and Prompt Debt

**The debt:** Long-running agent sessions accumulate stale assumptions, mistaken branches of reasoning, and compressed summaries of earlier context. Over time, the model starts obeying the residue of prior conversation instead of the actual current task.

**Mission's approach:** Mission uses zero-garbage execution.

- Work is sliced into bounded tasks rather than one monolithic session.
- Each task launch gets a fresh session with current mission context and task-specific authority.
- Durable truth lives in artifacts and mission state, not in transcript memory.

Task 15 should not depend on the accidental baggage of Task 1. Mission is designed so it does not have to.

## 4. Organizational and Governance Debt

**The debt:** Without explicit repository governance, the model defaults to its training priors. That is how teams end up with architecture violations, inconsistent stack choices, or repeated re-teaching of the same rules in every session.

**Mission's approach:** Mission moves governance out of repeated prompting and into system configuration.

- Repository rules live in durable control files such as `.agents/constitution.md` and `.agents/architecture.md`.
- Those rules are injected into task execution context automatically by the template renderer.
- The operator does not need to restate core engineering constraints in every prompt.

This is a structural answer to governance debt. The important rules are part of the operating environment, not just part of human vigilance.

## 5. Verification Debt

**The debt:** Agents are very good at sounding finished. That is not the same as being correct. Without explicit verification steps, teams merge code that reads plausibly but fails at the edges.

**Mission's approach:** Mission treats verification as first-class workflow state.

- During specification, the system generates paired implementation and `verify-` tasks.
- Verification tasks depend on their corresponding implementation tasks in the workflow DAG.
- The workflow cannot legitimately advance until validation work passes.
- The `AUDIT` stage adds repository-wide review before delivery is presented for human handoff.

Verification is not an afterthought or a promise. It is part of the mission structure.

## Deterministic State for Non-Deterministic Agents

Large language models will remain probabilistic systems. Mission does not pretend otherwise.

What Mission makes deterministic is the delivery frame around them:

- stage progression is explicit
- mission state is persisted
- artifacts are named and inspectable
- task boundaries are enforced
- rollback is cheap
- human control is operational instead of rhetorical

That is the core claim behind the product. Mission does not ask teams to trust AI memory, agent discipline, or terminal scrollback. It gives them a reducer-backed workflow state, isolated execution environments, and explicit checkpoints so they can use AI speed without absorbing compounding AI technical debt.