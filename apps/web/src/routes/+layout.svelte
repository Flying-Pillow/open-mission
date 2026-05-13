<script lang="ts">
	import "../app.css";
	import { browser } from "$app/environment";
	import type { Snippet } from "svelte";
	import { ModeWatcher } from "mode-watcher";
	import { asset } from "$app/paths";
	import { Toaster } from "svelte-sonner";

	let { children }: { children: Snippet } = $props();
</script>

<ModeWatcher />
{#if browser}
	<Toaster richColors closeButton position="top-right" />
{/if}

<svelte:head>
	<link rel="icon" href={asset("/favicon.ico")} sizes="any" />
	<link rel="icon" type="image/png" href={asset("/favicon.png")} />
	<link rel="apple-touch-icon" href={asset("/apple-touch-icon.png")} />
</svelte:head>

{@render children()}
