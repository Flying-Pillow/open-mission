---
layout: default
title: Mission
nav_title: Overview
nav_order: 1
---

# Flying Pillow Mission

<section class="mission-home-hero">
	<span class="mission-home-kicker">Operator-first AI Delivery</span>
	<div class="mission-home-title">Flying Pillow Mission</div>
	<p class="mission-home-tagline">Mission turns AI coding from a fragile chat habit into a controlled delivery system with bounded workspaces, staged artifacts, live supervision, and runtime freedom.</p>
	<div class="mission-home-actions">
		<a class="btn btn-primary" href="{{ '/getting-started/installation/' | relative_url }}">Start Here</a>
		<a class="btn" href="{{ '/getting-started/start-your-first-mission/' | relative_url }}">Prepare a Mission</a>
		<a class="btn" href="{{ '/user-manual/workflow-control/' | relative_url }}">Open the Tower Guide</a>
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

Instead of one long chat session working directly on your active branch, Mission turns software delivery into a governed operational flow:

- adopt a repository once
- start a mission from a new brief or an existing GitHub issue
- let Mission create an isolated mission workspace
- move through requirements, specification, implementation, audit, and delivery
- monitor and steer everything from the Mission Control Tower

The result is a workflow that feels closer to running a flight operation than babysitting a chatbot.

## What Mission Is For

Mission exists to solve the problems that show up as soon as AI coding becomes real work instead of a demo:

- agents lose architectural discipline in long, improvised sessions
- verification gets mixed together with implementation
- active branches become unsafe places to experiment
- crashes and disconnects destroy context
- humans lose the ability to intervene cleanly

Mission fixes that by separating intake, planning, implementation, verification, audit, and delivery into explicit artifacts, explicit tasks, and explicit runtime state.

## What Using Mission Feels Like

Mission is built around a simple operator journey:

1. Install Mission and open the Tower.
2. Register or switch to the repository you want to operate on.
3. Prepare a mission from a brief or select an existing GitHub issue.
4. Review the generated dossier and let the workflow advance from `prd` to `spec` to `implementation`, then `audit` and `delivery`.
5. Watch stages, tasks, artifacts, and live agent sessions in the Tower.
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

The workflow engine, runtime contract, and Tower all treat the agent layer as a replaceable execution boundary. Today, the built-in runtimes in the codebase are `copilot-cli` and `copilot-sdk`, and repository settings already separate:

- the selected runtime
- the default execution mode
- the default model
- task-level runner assignment in workflow settings and task templates

That matters because it keeps Mission's workflow model independent from any one provider. The current alpha is not yet shipping first-class runners for Claude Code, Gemini CLI, Codex, Pi, and similar tools, but the system is clearly built so those runtimes can be added without redesigning how missions, stages, artifacts, and Tower control work.

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

- the public CLI centers on launching Tower, installing prerequisites, inspecting airport state, and stopping the daemon
- Tower currently requires Bun at runtime
- GitHub is the tracking provider used by the implemented mission intake flows
- repository scaffolding is real, but `mission init` is not currently exposed as a public routed command

Those constraints do not change the product direction. They just define the current operational boundary.

## What To Read Next

- [Installation](getting-started/installation.md) explains the first-run operator setup.
- [Repository Setup](getting-started/repository-setup.md) explains how to adopt a repository and keep the control layer separate from delivery work.
- [Start Your First Mission](getting-started/start-your-first-mission.md) walks through intake from a brief or an existing issue.
- [Mission Lifecycle](core-workflows/mission-lifecycle.md) explains the five stages, their artifacts, and how work moves forward.
- [Mission Control Tower](user-manual/workflow-control.md) explains how to monitor and steer live work.