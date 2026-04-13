---
layout: default
title: Agents, Runtimes, and Models
parent: User Manual
nav_order: 3
---

# Agents, Runtimes, and Models

Mission is not the model and it is not the coding agent. Mission is the orchestration layer above the agent.

Mission is designed so your workflow is not trapped inside one vendor's chat model.

The core idea is simple: a mission, a task, and a delivery flow should outlive any one agent runtime. That is why Mission treats the live agent as a replaceable execution layer rather than as the definition of the product.

Mission controls the mission lifecycle, state transitions, artifacts, and operator control surface. The agent runtime is what Mission calls when a specific task needs to be executed.

## Task Versus Session

The most important distinction is:

| Concept | What it means |
| --- | --- |
| Task | The bounded unit of planned work in the mission |
| Session | The live agent runtime currently working on that task |

That separation is what allows Mission to stay stable even as runtimes evolve.

## What Mission Supports Today

In the current codebase, the built-in runtimes are:

- `copilot-cli`
- `pi`

Those are the concrete adapters Mission ships today. For the current product story, Copilot CLI is the first real agent integration to emphasize. The broader point is architectural: these are execution adapters under Mission, not the definition of Mission itself.

Claude Code, Gemini CLI, Codex, Pi, and similar runtimes are the natural next wave. Mission is already shaped so those agents can plug into the same mission lifecycle instead of forcing teams to adopt a new workflow every time they change runtime.

## Why This Still Matters For Agent Freedom

Even in alpha, Mission already separates:

- workflow policy
- runtime selection
- transport behavior
- default execution mode
- default model
- task-level runner assignment

That means the workflow is not welded to one provider's assumptions. Mission can keep the same mission lifecycle, the same Tower, and the same artifact model even as the runtime layer broadens.

This is the architectural reason Mission can realistically grow toward runners for tools such as Claude Code, Gemini CLI, Codex, Pi, and others without turning the rest of the product upside down. The orchestration layer stays stable while the execution layer broadens.

## Models And Modes

Mission already carries repository-level defaults for:

- `agentRuntime`
- `defaultAgentMode`
- `defaultModel`

Those defaults live in repository settings and are fed into session launch behavior. That means Mission already understands that “which runtime should do the work” and “which model or mode should be preferred” are separate concerns.

The workflow settings and task templates can also assign an `agentRunner` per task. That is the mechanism that keeps the product open to using different runtimes for different kinds of work.

## Verification Versus Coding

Mission's workflow already distinguishes implementation tasks from verification tasks. That is important because it opens the door to using different execution strategies for writing code and validating it.

Current alpha reality:

- task-level runner choice exists in the workflow model
- repository-level model defaults exist
- per-task model selection is not yet exposed as a first-class workflow setting

That is still a strong foundation. It means Mission is already structured for “different brain for different job” thinking instead of assuming one model must do everything.

## What The Operator Can Do With A Live Session

Once a session exists, Mission can normalize it behind one common contract:

- start it
- attach to it
- prompt it
- issue structured commands
- cancel it
- terminate it

This is why Tower can remain coherent even when runtimes differ. The operator sees one supervisory model, not a separate control philosophy for every provider.

## Why This Is Productively Different

Mission does not want to be “the Copilot workflow” or “the Claude workflow.” It wants to be the workflow layer that can supervise AI delivery regardless of which runtime is best suited for a given repository, team, or task type.

That freedom is one of the most compelling reasons to use Mission. The workflow, evidence model, and Tower remain stable while the agent layer can evolve underneath them.