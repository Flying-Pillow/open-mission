---
layout: default
title: Mission
nav_title: Overview
nav_order: 1
---

<section class="mission-home-hero">
	<span class="mission-home-kicker">Operator-first AI Delivery</span>
	<div class="mission-home-title">Flying Pillow Mission</div>
	<p class="mission-home-tagline">Mission is an orchestration layer for software delivery: it controls the workflow, stages the evidence, and dispatches well-defined tasks to coding agents instead of pretending to be the agent itself.</p>
	<div class="mission-home-actions">
		<a class="btn btn-primary" href="{{ '/getting-started/installation.html' | relative_url }}">Start Here</a>
		<a class="btn" href="{{ '/getting-started/start-your-first-mission.html' | relative_url }}">Prepare a Mission</a>
		<a class="btn" href="{{ '/user-manual/workflow-control.html' | relative_url }}">Open the Terminal Guide</a>
	</div>
	<div class="mission-home-grid">
		<div class="mission-home-card">
			<strong>Safe By Design</strong>
			<span>Keep agent work in isolated mission workspaces instead of your active branch.</span>
		</div>
		<div class="mission-home-card">
			<strong>Structured Delivery</strong>
			<span>Move from brief to PRD, SPEC, implementation, audit, and delivery with named artifacts.</span>
		</div>
		<div class="mission-home-card">
			<strong>Runtime Freedom</strong>
			<span>Keep the workflow stable while the runtime layer stays open to different agents and models.</span>
		</div>
	</div>
</section>

Mission is for teams that want the speed of AI coding agents without giving up architectural discipline, repository safety, or human control.

Mission is not a model and it is not a coding agent. It is the orchestration layer that governs how software moves from intake to delivery. Agents are the execution workers underneath that layer, launched to perform bounded, well-defined tasks inside a controlled mission flow.

Instead of one long chat session working directly on your active branch, Mission turns software delivery into a governed operational flow:

- adopt a repository once
- start a mission from a new brief or an existing GitHub issue
- let Mission create an isolated mission workspace
- move through requirements, specification, implementation, audit, and delivery
- monitor and steer everything from the Mission terminal surface

The result is a workflow that feels closer to running a flight operation than babysitting a chatbot.

## What Mission Actually Is

Mission sits above the agent runtime.

- Mission controls the flow of work.
- Mission decides which stage comes next.
- Mission persists the mission state and artifacts.
- Mission gives the operator a published CLI, an Airport terminal layout, and daemon control surfaces.
- The coding agent is used to execute the current task inside that structure.

That distinction is the whole point of the product. The value is not just "AI that can code." The value is a governed operating layer that keeps coding work bounded, inspectable, recoverable, and steerable.

## What Mission Is For

Mission exists to solve the problems that show up as soon as AI coding becomes real work instead of a demo:

- agents lose architectural discipline in long, improvised sessions
- verification gets mixed together with implementation
- active branches become unsafe places to experiment
- crashes and disconnects destroy context
- humans lose the ability to intervene cleanly

Mission fixes that by separating intake, planning, implementation, verification, audit, and delivery into explicit artifacts, explicit tasks, and explicit runtime state.

If you want the shortest explanation of why that operating model matters, read [AI Technical Debt and Mission](core-workflows/ai-technical-debt.md).

## What Using Mission Feels Like

Mission is built around a simple operator journey:

1. Install Mission and launch the terminal surface.
2. Register or switch to the repository you want to operate on.
3. Prepare a mission from a brief or select an existing GitHub issue.
4. Review the generated dossier and let the workflow advance from `prd` to `spec` to `implementation`, then `audit` and `delivery`.
5. Watch stages, tasks, artifacts, and live agent sessions in the Airport layout, with Tower as the left-side control surface.
6. Pause, resume, relaunch, interrupt, or panic-stop work whenever you need to.
7. Deliver from a verified mission workspace instead of hoping an AI chat stayed in bounds.

Mission is intentionally opinionated about process, but lightweight in day-to-day operation. The product is designed so the operator always understands what exists, what is running, what produced an artifact, and what still needs human judgment.

## Why Teams Adopt It

Mission is attractive when you care about these outcomes:

| Outcome | What Mission does |
| --- | --- |
| Protect the main checkout | Runs work in isolated mission workspaces and worktrees |
| Reduce context drift | Breaks missions into staged artifacts and bounded task sessions |
| Make progress recoverable | Persists mission runtime state instead of relying on terminal scrollback |
| Keep humans in charge | Exposes pause, panic, launch policy, and task-level control as first-class operations |
| Separate writing from verification | Uses explicit verification tasks and a dedicated `VERIFY.md` artifact |
| Avoid vendor lock-in at the workflow layer | Keeps runtime selection separate from workflow policy |

## Freedom Without Workflow Chaos

Mission is not meant to lock you into one giant vendor-specific session.

The workflow engine, runtime contract, and Mission terminal surfaces all treat the agent layer as a replaceable execution boundary. Today, the built-in runtimes in the codebase are `copilot-cli` and `copilot-sdk`, and repository settings already separate:

- the selected runtime
- the default execution mode
- the default model
- task-level runner assignment in workflow settings and task templates

That matters because it keeps Mission's workflow model independent from any one provider. In practical terms: Mission orchestrates, the selected agent executes. Today the first shipped agent path is Copilot, with `copilot-cli` as the first concrete CLI runtime and `copilot-sdk` also present in the codebase. Claude Code, Gemini CLI, Codex, and other runtimes are intended follow-on integrations rather than a redesign of the product.

## The Mission Flow In One View

Every mission starts with intent and ends with delivery evidence:

| Step | What the operator gets |
| --- | --- |
| Brief or issue intake | A concrete mission with title, scope, and tracking link |
| PRD stage | A requirements document that states the problem and success criteria |
| SPEC stage | A technical plan that bounds how the change should be built |
| Implementation stage | Bounded coding tasks plus paired verification work |
| Audit stage | Recorded findings, residual risks, and post-build review |
| Delivery stage | A final delivery artifact for handoff and release readiness |

That staged model is what makes Mission feel safe. It does not ask you to trust a stream of agent output. It gives you checkpoints, artifacts, and explicit runtime state at every step.

## Current Alpha Reality

Mission is already usable, but it is still an alpha product. A few current truths matter for operators:

- the published CLI package is `@flying-pillow/mission`
- the public CLI centers on opening the Mission terminal surface, installing prerequisites, inspecting airport state, and stopping the daemon
- the Airport terminal surfaces currently require Bun at runtime
- GitHub is the tracking provider used by the implemented mission intake flows
- repository scaffolding is real, but `mission init` is not currently exposed as a public routed command

Those constraints do not change the product direction. They just define the current operational boundary.

## What To Read Next

- [Installation](getting-started/installation.md) explains the first-run operator setup.
- [AI Technical Debt](core-workflows/ai-technical-debt.md) explains the failure modes Mission is explicitly designed to contain.
- [Repository Setup](getting-started/repository-setup.md) explains how to adopt a repository and keep the control layer separate from delivery work.
- [Start Your First Mission](getting-started/start-your-first-mission.md) walks through intake from a brief or an existing issue.
- [Mission Lifecycle](core-workflows/mission-lifecycle.md) explains the five stages, their artifacts, and how work moves forward.
- [Mission Terminal Control](user-manual/workflow-control.md) explains how to monitor and steer live work.