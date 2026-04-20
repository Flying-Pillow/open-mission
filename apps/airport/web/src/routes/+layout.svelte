<script lang="ts">
	import "../app.css";
	import type { Snippet } from "svelte";
	import { browser } from "$app/environment";
	import { asset } from "$app/paths";
	import { page } from "$app/state";
	import { ModeWatcher } from "mode-watcher";
	import {
		createAppContext,
		setAppContext,
	} from "$lib/client/context/app-context.svelte";
	//import { shouldRenderDaemonRouteContent } from "$lib/server/daemon/route-access";
	import type { LayoutData } from "./$types";

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	const appContext = createAppContext(() => data.appContext);
	let retryReloadTimer: ReturnType<typeof setTimeout> | undefined;
	const showsRouteContent = $derived(true
		//shouldRenderDaemonRouteContent({
		//	pathname: page.url.pathname,
		//	daemonRunning: appContext.daemon.running,
		//}),
	);

	setAppContext(appContext);

	$effect(() => {
		appContext.syncServerContext(data.appContext);
	});

	$effect(() => {
		if (retryReloadTimer) {
			clearTimeout(retryReloadTimer);
			retryReloadTimer = undefined;
		}

		if (
			!browser ||
			showsRouteContent ||
			!appContext.daemon.nextRetryAt
		) {
			return;
		}

		const retryAtMs = new Date(appContext.daemon.nextRetryAt).getTime();
		if (!Number.isFinite(retryAtMs)) {
			return;
		}

		const delayMs = retryAtMs - Date.now();
		if (delayMs <= 0) {
			window.location.reload();
			return;
		}

		retryReloadTimer = setTimeout(() => {
			window.location.reload();
		}, delayMs);

		return () => {
			if (retryReloadTimer) {
				clearTimeout(retryReloadTimer);
				retryReloadTimer = undefined;
			}
		};
	});
</script>

<ModeWatcher />

<svelte:head>
	<link rel="icon" href={asset("/favicon.ico")} sizes="any" />
	<link rel="icon" type="image/png" href={asset("/favicon.png")} />
	<link rel="apple-touch-icon" href={asset("/apple-touch-icon.png")} />
</svelte:head>

{#if showsRouteContent}
	{@render children()}
{:else}
	<div
		class="flex min-h-svh items-center justify-center bg-background px-6 py-10"
	>
		<section
			class="w-full max-w-xl rounded-3xl border bg-card/80 px-8 py-7 text-center shadow-sm backdrop-blur-sm"
		>
			<p
				class="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground"
			>
				Mission Daemon
			</p>
			<h1 class="mt-4 text-2xl font-semibold text-foreground">
				Daemon is not running
			</h1>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				{appContext.daemon.message}
			</p>
			{#if appContext.daemon.nextRetryAt}
				<p class="mt-3 text-xs text-muted-foreground">
					Retrying after {appContext.daemon.nextRetryAt}
				</p>
			{/if}
			{#if appContext.daemon.failureCount}
				<p class="mt-1 text-xs text-muted-foreground">
					Failed recovery attempts: {appContext.daemon.failureCount}
				</p>
			{/if}
			<div class="mt-6 flex items-center justify-center gap-3">
				<span class="size-2.5 animate-pulse rounded-full bg-amber-500"
				></span>
				<p class="text-sm font-medium text-foreground">
					Waiting for the next recovery window
				</p>
			</div>
		</section>
	</div>
{/if}
