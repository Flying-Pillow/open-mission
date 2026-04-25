<svelte:head>
	<title>Mission | Operator Workflow Control</title>
	<meta
		name="description"
		content="Mission is the operator surface for repository-backed workflows, daemon control, and AI-assisted execution."
	/>
</svelte:head>

<script lang="ts">
	const primaryLinks = [
		{ label: "Open Airport", href: "/airport" },
		{ label: "Documentation", href: "/docs" },
	];

	const highlights = [
		{
			title: "Repository Control",
			description:
				"Track repositories, missions, sessions, and artifacts from one operator surface.",
		},
		{
			title: "Mission Runtime",
			description:
				"Observe mission state, terminals, and action scopes without dropping into ad hoc tooling.",
		},
		{
			title: "Strict OOD Surface",
			description:
				"Client state converges on singleton application and entity containers modeled after the Flying Pillow reference app.",
		},
		];
</script>

<div class="min-h-svh bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_30%),linear-gradient(180deg,_#07111b_0%,_#0b1220_45%,_#f8fafc_45%,_#f8fafc_100%)] text-slate-950">
	<header class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 text-white">
		<a href="/" class="text-lg font-semibold tracking-[0.18em] uppercase">Mission</a>
		<nav class="flex items-center gap-3 text-sm">
			{#each primaryLinks as link}
				<a
					href={link.href}
					class={`rounded-full px-4 py-2 transition ${link.href === '/airport' ? 'bg-white text-slate-950' : 'border border-white/20 text-white hover:border-white/40'}`}
				>
					{link.label}
				</a>
			{/each}
		</nav>
	</header>

	<main>
		<section class="mx-auto grid w-full max-w-6xl gap-10 px-6 pt-16 pb-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
			<div class="text-white">
				<p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-300">Operator Platform</p>
				<h1 class="mt-5 max-w-4xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
					Mission control for repository-native workflows.
				</h1>
				<p class="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
					Use Airport to coordinate repositories, launch missions, inspect runtime state,
					and drive agent sessions through a structured application shell instead of scattered route logic.
				</p>
				<div class="mt-8 flex flex-wrap gap-4">
					<a href="/airport" class="rounded-full bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300">
						Open Airport
					</a>
					<a href="/docs" class="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5">
						Read Docs
					</a>
				</div>
			</div>

			<section class="rounded-[2rem] border border-white/10 bg-white/8 p-6 text-white backdrop-blur-xl">
				<p class="text-sm font-medium uppercase tracking-[0.22em] text-slate-300">Current Direction</p>
				<div class="mt-4 space-y-4 text-sm leading-7 text-slate-200">
					<p>The public root is now reserved for the product landing surface.</p>
					<p>The authenticated operator shell moves under a dedicated route group, matching the reference app’s structure more closely.</p>
					<p>Repository and mission work continue converging toward singleton application-owned entities and container-driven UI state.</p>
				</div>
			</section>
		</section>

		<section class="bg-slate-50 py-20">
			<div class="mx-auto w-full max-w-6xl px-6">
				<div class="max-w-2xl">
					<p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Why This Split</p>
					<h2 class="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Public website outside, operator application inside.</h2>
				</div>
				<div class="mt-10 grid gap-6 md:grid-cols-3">
					{#each highlights as highlight}
						<article class="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
							<h3 class="text-lg font-semibold text-slate-950">{highlight.title}</h3>
							<p class="mt-3 text-sm leading-7 text-slate-600">{highlight.description}</p>
						</article>
					{/each}
				</div>
			</div>
		</section>
	</main>
</div>
