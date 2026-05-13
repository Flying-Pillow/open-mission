<script lang="ts">
	import type { Snippet } from "svelte";
	import type { LayoutData } from "./$types";
	import DocsLayoutHeader from "$lib/components/docs/docs-layout-header.svelte";
	import DocsSidebar from "$lib/components/docs/docs-sidebar.svelte";
	import {
		SidebarInset,
		SidebarProvider,
	} from "$lib/components/ui/sidebar/index.js";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<SidebarProvider>
	<DocsSidebar
		variant="inset"
		navigation={data.navigation}
		site={data.site}
	/>

	<SidebarInset
		class="min-h-0 overflow-hidden h-svh md:peer-data-[variant=inset]:my-0"
	>
		<DocsLayoutHeader site={data.site} />

		<div class="docs-shell min-h-0 flex-1 overflow-auto">
			<div class="mx-auto flex min-h-full w-full max-w-7xl flex-col">
				{@render children()}
			</div>
		</div>
	</SidebarInset>
</SidebarProvider>
