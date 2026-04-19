<!-- /apps/airport/web/src/routes/+layout.svelte: Root layout that seeds app-wide client context and renders route content. -->
<script lang="ts">
	import "../app.css";
	import { ModeWatcher } from "mode-watcher";
	import { getAirportRepositories } from "./airport.remote";
	import { onMount, type Snippet } from "svelte";
	import { asset } from "$app/paths";
	import {
		createAppContext,
		setAppContext,
	} from "$lib/client/context/app-context.svelte";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	const appContext = setAppContext(createAppContext(() => data.appContext));
	let repositoriesLoading = $state(false);

	onMount(() => {
		if (repositoriesLoading || appContext.airport.repositories.length > 0) {
			return;
		}

		repositoriesLoading = true;
		void getAirportRepositories({})
			.then((repositories) => {
				appContext.setRepositories(repositories);
			})
			.finally(() => {
				repositoriesLoading = false;
			});
	});
</script>

<svelte:head>
	<link rel="icon" href={asset("/favicon.ico")} sizes="any" />
	<link rel="icon" type="image/png" href={asset("/favicon.png")} />
	<link rel="apple-touch-icon" href={asset("/apple-touch-icon.png")} />
</svelte:head>

<ModeWatcher />

{@render children()}
