<script lang="ts">
	import "../app.css";
	import type { Snippet } from "svelte";
	import { ModeWatcher } from "mode-watcher";
	import { asset } from "$app/paths";

	let { children }: { children: Snippet } = $props();
</script>

<ModeWatcher />

<svelte:head>
	<link rel="icon" href={asset("/favicon.ico")} sizes="any" />
	<link rel="icon" type="image/png" href={asset("/favicon.png")} />
	<link rel="apple-touch-icon" href={asset("/apple-touch-icon.png")} />
</svelte:head>

{@render children()}
