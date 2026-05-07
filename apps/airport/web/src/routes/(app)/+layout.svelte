<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import {
		createAppContext,
		setAppContext,
	} from "$lib/client/context/app-context.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const appContext = createAppContext(() => data.appContext);
	setAppContext(appContext);

	onMount(() => {
		void (async () => {
			await appContext.application.initialize();
			await appContext.loadAirportRepositories();
		})().catch(() => undefined);
	});

	$effect(() => {
		appContext.syncServerContext(data.appContext);
	});
</script>

{@render children()}
