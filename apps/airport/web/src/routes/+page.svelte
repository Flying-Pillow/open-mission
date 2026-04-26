<script lang="ts">
	import ArrowRightIcon from "@tabler/icons-svelte/icons/arrow-right";
	import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
	import GitBranchIcon from "@tabler/icons-svelte/icons/git-branch";
	import PlayerPauseIcon from "@tabler/icons-svelte/icons/player-pause";
	import ShieldCheckIcon from "@tabler/icons-svelte/icons/shield-check";
	import Terminal2Icon from "@tabler/icons-svelte/icons/terminal-2";
	import { asset } from "$app/paths";
	import { Badge } from "$lib/components/ui/badge";
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";

	const logoPath = asset("/logo.png");
	const agentLogos = {
		anthropic: asset("/agents/anthropic.svg"),
		cursor: asset("/agents/cursor.svg"),
		githubCopilot: asset("/agents/github-copilot.svg"),
		google: asset("/agents/google.svg"),
	};

	const navLinks = [
		{ label: "Agents", href: "#agents" },
		{ label: "GitHub", href: "#github" },
		{ label: "Workflow", href: "#workflow" },
		{ label: "Docs", href: "/docs" },
	];

	const availableAgents = [
		{
			name: "Copilot CLI",
			status: "Available",
			logo: agentLogos.githubCopilot,
		},
		{ name: "pi", status: "Available", fallback: "pi" },
	];

	const plannedAgents = [
		{
			name: "Claude Code",
			status: "Coming soon",
			logo: agentLogos.anthropic,
		},
		{ name: "Codex CLI", status: "Coming soon", fallback: "Cx" },
		{ name: "OpenCode", status: "Coming soon", fallback: "OC" },
		{
			name: "Gemini CLI",
			status: "Coming soon",
			logo: agentLogos.google,
		},
		{
			name: "Cursor",
			status: "Coming soon",
			logo: agentLogos.cursor,
		},
		{ name: "Aider", status: "Coming soon", fallback: "AI" },
		{ name: "Continue", status: "Coming soon", fallback: "Co" },
		{ name: "Roo Code", status: "Coming soon", fallback: "Roo" },
	];

	const agentStrip = [
		...availableAgents,
		...plannedAgents,
		...availableAgents,
		...plannedAgents,
	];

	const audiences = [
		{
			title: "Developers",
			description:
				"Let agents work in bounded task sessions while you keep control of architecture, diffs, and verification.",
		},
		{
			title: "Project managers",
			description:
				"Move from GitHub issue or product brief to visible stages, reviewable artifacts, and PR-ready delivery evidence.",
		},
		{
			title: "AI software teams",
			description:
				"Standardize agent-assisted execution with shared governance instead of one-off chats and fragile terminal scripts.",
		},
	];

	const githubFlow = [
		"GitHub issue or brief intake",
		"Repository adoption through gh-backed operations",
		"Isolated mission worktree for agent execution",
		"PR delivery from verified mission state",
	];

	const harnessingPillars = [
		{
			title: "Mission owns orchestration intent",
			description:
				"The workflow engine decides when work starts, what context is sent, what stage is authoritative, and when a human gate must stop progress.",
		},
		{
			title: "Adapters own provider mechanics",
			description:
				"Copilot CLI, pi, and future runners translate Mission intent into each provider's executable or SDK without redefining workflow policy.",
		},
		{
			title: "Operators keep live control",
			description:
				"Pause, interrupt, checkpoint, relaunch, or panic-stop an agent session while Mission keeps the durable mission state intact.",
		},
	];

	const workflowStages = [
		"Issue",
		"PRD",
		"SPEC",
		"Implement",
		"Verify",
		"Audit",
		"PR",
	];

	const safeguards = [
		"Isolated Git worktrees keep the control checkout clean.",
		".agents/constitution.md carries repository-specific engineering rules into task sessions.",
		"Manual and CI gates separate agent claims from verified delivery.",
		"First-class panic control halts automated work until an operator reviews it.",
	];

	const technicalProof = [
		{ label: "mission.json", value: "Reducer-backed mission truth" },
		{ label: "AgentRunner", value: "Provider-neutral runner contract" },
		{
			label: "AgentSession",
			value: "Live command and observation boundary",
		},
		{
			label: "GitHubPlatformAdapter",
			value: "gh-backed clone, issue, PR, merge, and sync",
		},
	];

	const comparisonRows = [
		{
			label: "Chat-first tools",
			value: "One long context, improvised process, work often lands directly in the active checkout.",
		},
		{
			label: "Mission",
			value: "A deterministic state machine that harnesses agents through staged artifacts, isolated worktrees, GitHub tracking, and PR delivery.",
		},
	];
</script>

<svelte:head>
	<title>Mission | AI Agent Orchestration for GitHub Software Teams</title>
	<meta
		name="description"
		content="Mission harnesses coding agents through governed, GitHub-connected, recoverable software delivery workflows."
	/>
</svelte:head>

<div class="min-h-svh bg-[#f8fafc] text-slate-950">
	<header
		class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl"
	>
		<div
			class="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8"
		>
			<a
				href="/"
				class="flex min-w-0 items-center gap-3"
				aria-label="Mission home"
			>
				<img src={logoPath} alt="" class="size-9 shrink-0 rounded-lg" />
				<span
					class="text-sm font-semibold uppercase tracking-[0.18em] text-slate-950"
					>Mission</span
				>
			</a>

			<nav
				class="hidden items-center gap-1 md:flex"
				aria-label="Primary navigation"
			>
				{#each navLinks as link (link.href)}
					<a
						href={link.href}
						class="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
					>
						{link.label}
					</a>
				{/each}
			</nav>

			<div class="flex items-center gap-2">
				<Button
					href="/docs"
					variant="ghost"
					size="sm"
					class="hidden sm:inline-flex">Docs</Button
				>
				<Button
					href="/airport"
					size="sm"
					class="bg-slate-950 text-white hover:bg-slate-800"
				>
					Open Airport
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			</div>
		</div>
	</header>

	<main>
		<section class="relative overflow-hidden bg-slate-950 text-white">
			<div
				class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/60 to-transparent"
			></div>
			<div
				class="mission-hero-grid mx-auto w-full max-w-7xl items-center gap-8 px-4 py-14 sm:px-6 md:gap-10 md:py-16 lg:px-8 lg:py-20"
			>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<Badge
							class="border-fuchsia-300/30 bg-fuchsia-300/15 text-fuchsia-100"
							>Public Alpha</Badge
						>
						<Badge
							class="border-white/15 bg-white/10 text-slate-200"
							>GitHub-native delivery</Badge
						>
					</div>

					<h1
						class="mt-6 max-w-3xl text-4xl font-semibold leading-[1.04] text-balance md:text-5xl xl:text-6xl"
					>
						Harness coding agents without surrendering your software
						process.
					</h1>
					<p
						class="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg"
					>
						Mission is the orchestration engine for AI-driven
						software development: a local state machine, Airport
						control surface, and GitHub-connected governance layer
						that turns coding agents into bounded workers.
					</p>

					<div class="mt-8 flex flex-col gap-3 sm:flex-row">
						<Button
							href="/docs"
							size="lg"
							class="bg-fuchsia-500 text-white hover:bg-fuchsia-400"
						>
							Read the developer guide
							<ArrowRightIcon data-icon="inline-end" />
						</Button>
						<Button
							href="/airport"
							variant="outline"
							size="lg"
							class="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
						>
							Open Airport
						</Button>
					</div>

					<div
						class="mt-8 grid max-w-2xl gap-3 text-sm text-slate-300 sm:grid-cols-3"
					>
						<div class="flex items-center gap-2">
							<BrandGithubIcon class="size-4 text-white" />
							Issue to PR flow
						</div>
						<div class="flex items-center gap-2">
							<ShieldCheckIcon class="size-4 text-white" />
							Isolated worktrees
						</div>
						<div class="flex items-center gap-2">
							<Terminal2Icon class="size-4 text-white" />
							Agent runtime boundary
						</div>
					</div>
				</div>

				<div class="min-w-0 lg:flex lg:justify-end">
					<div
						class="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl"
					>
						<div
							class="flex items-center justify-between border-b border-white/10 pb-4"
						>
							<div>
								<p
									class="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200"
								>
									Mission Control
								</p>
								<p class="mt-1 text-sm text-slate-300">
									GitHub issue #428 -> verified PR
								</p>
							</div>
							<Badge class="bg-emerald-400/15 text-emerald-100"
								>Agent active</Badge
							>
						</div>

						<div
							class="mt-5 grid gap-3 sm:grid-cols-[0.85fr_1.15fr]"
						>
							<div
								class="rounded-xl border border-white/10 bg-slate-950/80 p-4"
							>
								<div
									class="flex items-center gap-2 text-sm font-medium text-white"
								>
									<BrandGithubIcon class="size-4" />
									GitHub intake
								</div>
								<div
									class="mt-4 space-y-3 text-sm text-slate-300"
								>
									<div class="rounded-lg bg-white/5 p-3">
										Issue linked
									</div>
									<div class="rounded-lg bg-white/5 p-3">
										Worktree provisioned
									</div>
									<div class="rounded-lg bg-white/5 p-3">
										PR target ready
									</div>
								</div>
							</div>

							<div
								class="rounded-xl border border-white/10 bg-slate-900/80 p-4"
							>
								<div
									class="flex items-center justify-between gap-3"
								>
									<div>
										<p
											class="text-sm font-medium text-white"
										>
											Agent harness
										</p>
										<p class="mt-1 text-xs text-slate-400">
											Copilot CLI in bounded task session
										</p>
									</div>
									<PlayerPauseIcon
										class="size-5 text-fuchsia-200"
									/>
								</div>

								<div class="mt-5 space-y-3">
									{#each workflowStages as stage, index (stage)}
										<div class="flex items-center gap-3">
											<span
												class="flex size-7 shrink-0 items-center justify-center rounded-full bg-fuchsia-400/15 text-xs font-semibold text-fuchsia-100"
											>
												{index + 1}
											</span>
											<div
												class="h-2 flex-1 rounded-full bg-white/10"
											>
												<div
													class="h-2 rounded-full bg-gradient-to-r from-fuchsia-400 to-emerald-300"
													style={`width: ${index < 4 ? 100 : index === 4 ? 72 : 28}%`}
												></div>
											</div>
											<span
												class="w-20 text-right text-xs text-slate-300"
												>{stage}</span
											>
										</div>
									{/each}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>

		<section
			id="agents"
			class="border-b border-slate-200 bg-white py-5"
			aria-label="Supported coding agents"
		>
			<div
				class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 sm:px-6 lg:px-8"
			>
				<div
					class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
				>
					<p class="text-sm font-semibold text-slate-950">
						Harness the agents your team already trusts.
					</p>
					<p
						class="text-xs font-medium uppercase tracking-[0.18em] text-slate-500"
					>
						Copilot CLI and pi available now
					</p>
				</div>

				<div
					class="agent-marquee overflow-hidden"
					aria-label="Available and planned agent adapters"
				>
					<div class="agent-marquee__track flex w-max gap-3">
						{#each agentStrip as agent, index (`${agent.name}-${index}`)}
							<div
								class="flex h-12 min-w-44 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 text-slate-950 shadow-sm"
							>
								<span
									class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-xs font-semibold text-white"
								>
									{#if agent.logo}
										<img
											src={agent.logo}
											alt=""
											class="size-4"
											loading="lazy"
										/>
									{:else}
										{agent.fallback}
									{/if}
								</span>
								<span class="min-w-0">
									<span
										class="block truncate text-sm font-semibold"
										>{agent.name}</span
									>
									<span class="block text-xs text-slate-500"
										>{agent.status}</span
									>
								</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<section class="bg-slate-50 py-16 sm:py-20">
			<div
				class="mx-auto grid w-full max-w-7xl gap-5 px-4 sm:px-6 md:grid-cols-3 lg:px-8"
			>
				{#each audiences as audience (audience.title)}
					<Card.Root
						class="rounded-xl border-slate-200 bg-white shadow-sm"
						size="sm"
					>
						<Card.Header>
							<Card.Title class="text-lg"
								>{audience.title}</Card.Title
							>
							<Card.Description class="leading-7"
								>{audience.description}</Card.Description
							>
						</Card.Header>
					</Card.Root>
				{/each}
			</div>
		</section>

		<section id="github" class="bg-white py-16 sm:py-24">
			<div
				class="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8"
			>
				<div>
					<Badge
						variant="outline"
						class="bg-fuchsia-50 text-fuchsia-900"
						>GitHub integration</Badge
					>
					<h2
						class="mt-4 max-w-xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl"
					>
						From issue intake to pull request delivery, Mission
						treats GitHub as operational truth.
					</h2>
					<p
						class="mt-5 max-w-2xl text-base leading-8 text-slate-600"
					>
						Mission's current tracking provider is GitHub. It can
						prepare work from issues, adopt repositories through
						gh-backed platform operations, isolate agent execution
						in mission worktrees, and deliver verified changes
						through PRs.
					</p>
				</div>

				<div class="grid gap-3">
					{#each githubFlow as item, index (item)}
						<div
							class="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
						>
							<span
								class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-white"
							>
								{index + 1}
							</span>
							<p class="text-sm font-medium text-slate-800">
								{item}
							</p>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<section class="bg-slate-950 py-16 text-white sm:py-24">
			<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
				<div class="max-w-3xl">
					<Badge class="bg-white/10 text-slate-100"
						>Agent harnessing</Badge
					>
					<h2
						class="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl"
					>
						Mission governs the work. Agents execute bounded tasks.
					</h2>
					<p class="mt-5 text-base leading-8 text-slate-300">
						Mission does not pretend to be the model. It owns the
						orchestration layer around external coding agents:
						lifecycle, context, commands, state, recovery, and human
						control.
					</p>
				</div>

				<div class="mt-10 grid gap-5 lg:grid-cols-3">
					{#each harnessingPillars as pillar (pillar.title)}
						<Card.Root
							class="rounded-xl border-white/10 bg-white/[0.06] text-white ring-white/10"
							size="sm"
						>
							<Card.Header>
								<Card.Title class="text-lg text-white"
									>{pillar.title}</Card.Title
								>
								<Card.Description
									class="leading-7 text-slate-300"
									>{pillar.description}</Card.Description
								>
							</Card.Header>
						</Card.Root>
					{/each}
				</div>
			</div>
		</section>

		<section id="workflow" class="bg-white py-16 sm:py-24">
			<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
				<div
					class="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start"
				>
					<div>
						<Badge variant="outline">Structured delivery</Badge>
						<h2
							class="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl"
						>
							The mission flow keeps AI work inspectable.
						</h2>
						<p class="mt-5 text-base leading-8 text-slate-600">
							Every mission advances through named artifacts and
							verification gates, so teams can review
							requirements, technical plans, implementation
							output, audit findings, and delivery readiness
							without trusting a scrolling chat transcript.
						</p>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						{#each workflowStages as stage, index (stage)}
							<div
								class="rounded-xl border border-slate-200 bg-slate-50 p-4"
							>
								<span
									class="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-700"
									>Step {index + 1}</span
								>
								<p
									class="mt-2 text-lg font-semibold text-slate-950"
								>
									{stage}
								</p>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<section class="bg-slate-50 py-16 sm:py-24">
			<div
				class="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8"
			>
				<Card.Root
					class="rounded-xl border-slate-200 bg-white shadow-sm"
				>
					<Card.Header>
						<div class="flex items-center gap-3">
							<span
								class="flex size-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800"
							>
								<ShieldCheckIcon class="size-5" />
							</span>
							<Card.Title>Safety and governance</Card.Title>
						</div>
						<Card.Description class="leading-7">
							Mission is built for teams that want agent speed
							without giving up repository safety, architecture
							discipline, or human judgment.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<ul class="space-y-3 text-sm leading-7 text-slate-600">
							{#each safeguards as safeguard (safeguard)}
								<li class="flex gap-3">
									<span
										class="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500"
									></span>
									<span>{safeguard}</span>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>

				<Card.Root
					class="rounded-xl border-slate-200 bg-white shadow-sm"
				>
					<Card.Header>
						<div class="flex items-center gap-3">
							<span
								class="flex size-10 items-center justify-center rounded-lg bg-fuchsia-100 text-fuchsia-800"
							>
								<GitBranchIcon class="size-5" />
							</span>
							<Card.Title>Airport control surface</Card.Title>
						</div>
						<Card.Description class="leading-7">
							Airport gives operators the live surface for
							repository adoption, mission state, task control,
							agent sessions, and artifacts.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<div class="grid gap-3 sm:grid-cols-3">
							<div class="rounded-lg bg-slate-50 p-3">
								<p class="text-sm font-semibold text-slate-950">
									Tower
								</p>
								<p
									class="mt-1 text-xs leading-5 text-slate-500"
								>
									Mission steering
								</p>
							</div>
							<div class="rounded-lg bg-slate-50 p-3">
								<p class="text-sm font-semibold text-slate-950">
									Runway
								</p>
								<p
									class="mt-1 text-xs leading-5 text-slate-500"
								>
									Live agent session
								</p>
							</div>
							<div class="rounded-lg bg-slate-50 p-3">
								<p class="text-sm font-semibold text-slate-950">
									Briefing Room
								</p>
								<p
									class="mt-1 text-xs leading-5 text-slate-500"
								>
									Artifacts and specs
								</p>
							</div>
						</div>
					</Card.Content>
				</Card.Root>
			</div>
		</section>

		<section class="bg-white py-16 sm:py-24">
			<div class="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
				<div class="grid gap-10 lg:grid-cols-[0.82fr_1.18fr]">
					<div>
						<Badge variant="outline">Technical credibility</Badge>
						<h2
							class="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl"
						>
							Deterministic state around probabilistic workers.
						</h2>
						<p class="mt-5 text-base leading-8 text-slate-600">
							Mission keeps provider mechanics out of workflow
							policy. The agent runtime exposes normalized
							sessions and observations while mission state
							remains the durable source of truth.
						</p>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						{#each technicalProof as item (item.label)}
							<div
								class="rounded-xl border border-slate-200 bg-slate-50 p-4"
							>
								<p
									class="font-mono text-sm font-semibold text-slate-950"
								>
									{item.label}
								</p>
								<p
									class="mt-2 text-sm leading-6 text-slate-600"
								>
									{item.value}
								</p>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<section class="bg-slate-50 py-16 sm:py-24">
			<div class="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
				<div class="text-center">
					<Badge variant="outline">Why now</Badge>
					<h2
						class="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl"
					>
						AI coding needs an operating layer.
					</h2>
				</div>

				<div
					class="mt-10 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
				>
					{#each comparisonRows as row (row.label)}
						<div
							class="grid gap-3 border-b border-slate-200 p-5 last:border-b-0 sm:grid-cols-[12rem_1fr]"
						>
							<p class="font-semibold text-slate-950">
								{row.label}
							</p>
							<p class="leading-7 text-slate-600">{row.value}</p>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<section class="bg-slate-950 py-16 text-white sm:py-20">
			<div
				class="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8"
			>
				<div>
					<h2
						class="text-3xl font-semibold tracking-tight sm:text-4xl"
					>
						Start harnessing your coding agents.
					</h2>
					<p class="mt-4 max-w-2xl leading-8 text-slate-300">
						Bring GitHub issues, repository rules, and agent
						execution into one governed mission flow.
					</p>
				</div>
				<div class="flex flex-col gap-3 sm:flex-row">
					<Button
						href="/docs"
						size="lg"
						class="bg-fuchsia-500 text-white hover:bg-fuchsia-400"
						>Read docs</Button
					>
					<Button
						href="/airport"
						variant="outline"
						size="lg"
						class="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
					>
						Open Airport
					</Button>
				</div>
			</div>
		</section>
	</main>
</div>

<style>
	.mission-hero-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	@media (min-width: 768px) {
		.mission-hero-grid {
			grid-template-columns: minmax(0, 0.95fr) minmax(20rem, 1.05fr);
		}
	}

	.agent-marquee {
		mask-image: linear-gradient(
			90deg,
			transparent,
			black 8%,
			black 92%,
			transparent
		);
	}

	.agent-marquee__track {
		animation: agent-marquee 34s linear infinite;
	}

	@keyframes agent-marquee {
		from {
			transform: translateX(0);
		}

		to {
			transform: translateX(-50%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.agent-marquee {
			overflow-x: auto;
			mask-image: none;
		}

		.agent-marquee__track {
			animation: none;
		}
	}
</style>
