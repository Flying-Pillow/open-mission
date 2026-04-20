<script lang="ts">
	import type { DocsSiteMeta } from "$lib/docs/types";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";

	type Props = {
		site: DocsSiteMeta;
	};

	const missionRepositoryUrl = "https://github.com/Flying-Pillow/mission";

	let { site }: Props = $props();
</script>

<header
	class="sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center border-b bg-background/95 backdrop-blur"
>
	<div class="flex w-full items-center gap-2 px-4 lg:px-6">
		<Sidebar.Trigger class="-ml-1" />
		<Separator
			orientation="vertical"
			class="mx-2 data-[orientation=vertical]:h-4"
		/>
		<div class="min-w-0">
			<p class="text-[0.68rem] font-medium uppercase tracking-[0.24em] text-muted-foreground">
				Documentation
			</p>
			<a href="/docs" class="truncate text-sm font-semibold text-foreground sm:text-base">
				{site.title}
			</a>
		</div>
		{#if site.description}
			<p class="hidden max-w-2xl truncate text-sm text-muted-foreground xl:block">
				{site.description}
			</p>
		{/if}
		<div class="ms-auto flex items-center gap-2">
			<a
				href="/"
				class="rounded-full border border-border/70 bg-background/85 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
			>
				Airport
			</a>
			<a
				href={missionRepositoryUrl}
				target="_blank"
				rel="noreferrer"
				class="rounded-full border border-border/70 bg-background/85 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
			>
				GitHub
			</a>
		</div>
	</div>
</header>
