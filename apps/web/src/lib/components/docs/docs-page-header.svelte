<script lang="ts">
	import type { DocsPageSummary } from "$lib/docs/types";

	type Props = {
		page: DocsPageSummary;
	};

	let { page }: Props = $props();

	const eyebrow = $derived.by(() => {
		if (page.section) {
			return page.section;
		}

		return page.slug.length === 0 ? "Documentation" : "Section overview";
	});
</script>

<header class="rounded-3xl border bg-card/70 px-6 py-6 shadow-sm backdrop-blur-sm lg:px-8">
	<p class="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
		{eyebrow}
	</p>
	<h1 class="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
		{page.title}
	</h1>
	{#if page.description}
		<p class="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
			{page.description}
		</p>
	{/if}
	<div class="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
		<span class="rounded-full border border-border/70 bg-background/80 px-3 py-1.5">
			{page.href}
		</span>
		<span class="rounded-full border border-border/70 bg-background/80 px-3 py-1.5">
			{page.sourcePath}
		</span>
	</div>
</header>
