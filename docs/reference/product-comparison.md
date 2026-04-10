---
layout: default
title: Product Comparison
parent: Reference
nav_order: 3
---

# Product Comparison

<section class="mission-section-hero">
	<span class="mission-section-kicker">Landscape</span>
	<div class="mission-section-title">Mission is not a model and not a coding agent. It is the orchestration layer that controls AI software delivery.</div>
	<p class="mission-section-lead">Spec Kit, BMAD, and GSD all improve AI-assisted development, but they optimize for different things. This page compares their public operating models against Mission's current implementation so teams can choose the right system deliberately.</p>
</section>

<div class="mission-compare-callout">
	<strong>Scope of this comparison</strong>
	<p>This comparison is based on Mission's current codebase plus the public documentation and READMEs for Spec Kit, BMAD Method, and GSD/Get Shit Done. It focuses on workflow shape, control model, context handling, and recovery behavior rather than community size or branding.</p>
</div>

## The Short Version

<div class="mission-comparison-grid">
	<div class="mission-comparison-card">
		<span class="mission-section-card__eyebrow">Spec Kit</span>
		<strong>Best when you want a strong spec-first toolkit inside the agent you already use.</strong>
		<p>Spec Kit gives teams a structured specification pipeline, broad agent support, and deep extension and preset mechanics. It is a toolkit for spec-driven development, not a separate runtime control plane.</p>
	</div>
	<div class="mission-comparison-card">
		<span class="mission-section-card__eyebrow">BMAD</span>
		<strong>Best when you want guided workflows driven by specialized agent roles and modular methodology packs.</strong>
		<p>BMAD leans into persona-based collaboration, adaptive planning depth, and module ecosystems. It is workflow-rich and very flexible, but its center of gravity remains inside the agent session rather than a persisted external mission harness.</p>
	</div>
	<div class="mission-comparison-card">
		<span class="mission-section-card__eyebrow">GSD</span>
		<strong>Best when you want aggressive context engineering and fast plan-to-execution loops inside command-driven agent sessions.</strong>
		<p>GSD is the strongest public system in this group on explicit context-rot mitigation inside the agent workflow itself: fresh contexts, atomic task plans, parallel waves, and verification loops.</p>
	</div>
	<div class="mission-comparison-card">
		<span class="mission-section-card__eyebrow">Mission</span>
		<strong>Best when you need AI work to run like an operation, not a chat ritual.</strong>
		<p>Mission adds a daemon-backed control plane, explicit mission state, staged artifacts, isolated mission workspaces, and a live Tower interface so operators can start, supervise, pause, relaunch, verify, audit, and deliver while individual coding agents execute the bounded tasks underneath.</p>
	</div>
</div>

## Mission In One Sentence

Flying Pillow Mission is the orchestration layer that controls the proper flow of software development, while coding agents are used only to execute well-defined tasks inside that flow.

## Extended Comparison

<div class="mission-table-scroll">

| Dimension | Spec Kit | BMAD | GSD | Mission |
| --- | --- | --- | --- | --- |
| Primary operating model | Spec-driven development toolkit with a core command flow of constitution, specify, plan, tasks, and implement | AI-driven agile framework built around specialized roles, guided workflows, and modules | Lightweight meta-prompting and context-engineering system with discuss, plan, execute, verify loops | Orchestration layer for software delivery, with a daemon-backed mission harness, staged workflow execution, persistent state, and live operator supervision |
| Main unit of work | Spec artifacts and tasks inside the current agent environment | Workflows driven by domain-specific agents and modules | Milestones, phases, plans, summaries, and verification files under `.planning/` | Missions with stage folders, artifacts, tasks, sessions, and mission-local runtime state |
| Planning shape | Explicit spec-first flow with strong artifact generation | Adaptive planning depth guided by workflow and agent mix | Roadmap to phase to atomic plan flow optimized for fresh execution windows | PRD to SPEC to implementation to audit to delivery, with explicit gates and artifacts |
| Human control model | Human drives commands from inside the agent session | Human steers agent specialists and facilitated workflows | Human approves roadmap, verifies work, and can drive phase commands | Human supervises through the Tower and daemon APIs with pause, resume, relaunch, interrupt, and panic controls |
| Context strategy | Rich specs, plans, tasks, and organizational principles guide the agent | Guided workflows and role specialization shape what context is emphasized | Explicit context engineering: fresh context per plan, persistent planning files, context size discipline | Bounded mission artifacts, task-scoped execution, isolated mission workspaces, and persisted reducer state instead of relying on chat history |
| Persistent state outside chat | Project artifacts and generated command/templates | Project docs, module assets, and workflow outputs | Strong file-based state in `.planning/` plus summaries, handoffs, threads, and roadmap artifacts | Strong file and runtime state across `.mission/`, stage artifacts, task/session records, and `mission.json` |
| Execution isolation | Depends on the agent environment and chosen extensions/presets | Depends on the host agent and selected modules | Fresh subagent contexts and optional worktree isolation | Mission-local workspaces and worktrees, separated from the operator's active checkout |
| Verification model | Core and optional commands plus extensions can add analysis, checklist, review, and verification passes | Guided workflow quality depends on module and agent flow selection | Built-in plan checking, verifier passes, UAT flow, and debugger loops | Explicit verification tasks in implementation plus dedicated `VERIFY.md`, then audit and delivery stages |
| Recovery after interruption | Resume by returning to the spec artifacts and command flow | Resume by re-entering the guided workflow with project artifacts | Resume from `.planning/` state, summaries, handoffs, and phase records | Resume from persisted mission state and live Tower projections without reconstructing the whole workflow from chat memory |
| Runtime and agent openness | Very broad agent support plus generic bring-your-own-agent path | Works with assistants that support project context or custom prompts | Supports multiple runtimes and model profiles, but the workflow semantics are strongly shaped by the GSD command environment | Architecture separates workflow policy from runtime selection; the first shipped agent path is Copilot, with `copilot-cli` and `copilot-sdk` in the codebase today, and Claude Code, Gemini CLI, Codex, and others as planned follow-on runtimes |
| Brownfield posture | Supports existing repositories and has brownfield walkthroughs | Designed to scale from bug fixes to larger systems | Strong brownfield story through codebase mapping before project planning | Repository adoption is first-class, and missions can start from a new brief or an existing GitHub issue |
| Control surface | Agent commands, templates, extensions, and presets | Agent commands, help skill, modules, and workflow docs | Agent commands, settings, and planning artifacts | CLI, daemon APIs, mission state, and the Mission Control Tower |
| Best fit | Teams standardizing spec-first AI work inside existing agent tooling | Teams that like guided role specialization and methodology packs | Builders who want faster execution with explicit context-rot defenses inside the agent loop | Teams that need auditable, operator-controlled AI delivery around real repositories |

</div>

## Why Mission Exists If These Tools Already Exist

Mission agrees with the core insight behind the rest of this landscape: raw improvised chat is not a reliable way to ship software.

Where Mission diverges is in the layer where it chooses to solve the problem.

- Spec Kit improves the specification pipeline.
- BMAD improves the workflow guidance and role structure.
- GSD improves the in-agent execution loop with much stronger context handling.
- Mission moves one layer lower and says the workflow itself should have an operating system.

That means Mission is less interested in giving one agent session better prompts and more interested in giving the operator a durable control boundary around the whole mission.

Mission uses coding agents, but it is not itself a coding agent. The agents are execution components inside the system. Mission is the system that tells them what kind of work should happen, when it should happen, and how the results are reviewed and carried forward.

## Why Deterministic Harnessing Matters

The phrase "deterministic harness" does not mean the model becomes mathematically deterministic. Large language models are still probabilistic systems.

What Mission makes deterministic is the environment around the model and agent runtime:

- a mission has a known identity
- a mission has a known stage order
- each stage has known artifacts
- tasks and verification work are persisted as runtime state
- operator actions map to explicit control commands instead of ad hoc chat steering
- recovery does not depend on remembering what happened in a terminal scrollback buffer

That distinction matters in practice.

### 1. Less Context Rot

In a long shared session, the agent keeps carrying old assumptions, old failed attempts, and compressed summaries of prior work. Over time the context becomes polluted.

Mission reduces that by keeping the durable truth in mission artifacts and runtime state, then launching bounded work against the task at hand. The important memory is in the system, not in a single bloated conversation.

### 2. Less Context Loss Through Compression

When a workflow depends on one long chat, prior decisions get compacted into summaries. Summaries are useful, but they are also where nuance dies.

Mission keeps the key decision points in named artifacts such as `BRIEF.md`, `PRD.md`, `SPEC.md`, `VERIFY.md`, `AUDIT.md`, and `DELIVERY.md`. That gives the operator durable checkpoints instead of hoping the right details survive repeated summarization.

### 3. Better Human Intervention

In chat-centric systems, intervention often means typing another corrective paragraph and hoping it lands.

Mission makes intervention operational. The Tower can show what is running, what has finished, what runtime and model are configured, and where the mission currently sits. Operators can pause, relaunch, stop, or redirect work with an explicit control surface.

### 4. Better Failure Recovery

If an agent runtime crashes mid-task, the important question is whether the workflow state survives.

Mission is designed so the answer is yes. The mission record, stage artifacts, and session state outlive any one terminal session. Recovery becomes a workflow concern, not a memory exercise.

### 5. Better Separation Of Duties

Mission also makes it easier to separate writing from checking.

The workflow already models dedicated verification work and a dedicated audit stage. That matters when teams want different review depth, different models, or different runtime policies for implementation versus verification.

It also matters because orchestration and execution are different responsibilities. Mission handles orchestration. The selected coding agent handles execution.

## Where Mission Is Stronger Today

Mission is already stronger than most AI coding harnesses in a few specific ways:

- it treats repository adoption, mission intake, execution, audit, and delivery as one connected operational flow
- it gives operators a live terminal control surface instead of relying only on slash commands
- it persists mission state independently of any single agent session
- it makes isolated mission workspaces part of the default operating model
- it keeps workflow policy distinct from runtime selection

Those are architectural advantages, not just prompt-writing differences.

## Where Mission Is Still Earlier Than The Others

Mission is also younger and more opinionated than the tools above, and the current alpha has real limits:

- the first shipped agent path is Copilot, with `copilot-cli` and `copilot-sdk` in the codebase today
- the implemented issue intake path is GitHub-based
- Tower currently requires Bun at runtime
- the public routed CLI is still narrower than the internal system capabilities

So the right claim is not that Mission already has the widest ecosystem. It does not. The right claim is that Mission already has one of the strongest control-plane architectures for teams that care about reliability, supervision, and recoverability.

## Which One Should You Choose

Choose Spec Kit when your main need is a strong, extensible spec-first development toolkit that installs cleanly into the agent environments your team already uses.

Choose BMAD when your team wants richer guided workflows, specialized roles, and methodology modules that can adapt process depth to the job.

Choose GSD when you want the most aggressive public answer to context rot inside the agent workflow itself, with fresh task contexts, atomic plans, and strong execution speed.

Choose Mission when the real problem is not just better prompting, but controlling AI delivery as an observable, recoverable, operator-run system.