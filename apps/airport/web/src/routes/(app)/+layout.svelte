<script lang="ts">
	import { onMount } from "svelte";
	import type { Snippet } from "svelte";
	import {
		createAppContext,
		setAppContext,
	} from "$lib/client/context/app-context.svelte";
	import { app } from "$lib/client/Application.svelte.js";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const appContext = createAppContext(() => ({
		...data.appContext,
		systemState: data.systemState,
	}));
	setAppContext(appContext);

	onMount(() => {
		void (async () => {
			await app.initialize();
			await app.loadAirportRepositories();
		})().catch(() => undefined);
	});

	$effect(() => {
		appContext.syncServerContext({
			...data.appContext,
			systemState: data.systemState,
		});
	});
</script>

{@render children()}
