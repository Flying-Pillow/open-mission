<script lang="ts">
	import { page } from "$app/state";
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
		void appContext.application.initialize().catch(() => undefined);
	});

	$effect(() => {
		appContext.syncServerContext(data.appContext);
	});

	$effect(() => {
		appContext.application.syncPageState({
			pathname: page.url.pathname,
			repositoryId: page.params.repositoryId?.trim() || undefined,
			missionId: page.params.missionId?.trim() || undefined,
		});
	});
</script>

{@render children()}
