<script lang="ts">
	import { mode } from "mode-watcher";
	import { renderMermaidDiagrams } from "../../utils/mermaid.ts";
	import { tick } from "svelte";
	import type { Snippet } from "svelte";

	type Props = {
		children: Snippet;
	};

	let { children }: Props = $props();
	let articleElement = $state<HTMLElement | null>(null);

	async function enhanceContent(): Promise<void> {
		if (!articleElement) {
			return;
		}

		await tick();
		await renderMermaidDiagrams(articleElement);
	}

	$effect(() => {
		children;
		articleElement;
		void enhanceContent();
	});
</script>

<article
	bind:this={articleElement}
	class="markdown markdown-body"
	data-theme={mode.current}
>
	{@render children()}
</article>

<style>
	:global(.markdown .mermaid) {
		margin: 1.5rem 0;
		overflow-x: auto;
	}

	:global(.markdown .mermaid svg) {
		height: auto;
		max-width: 100%;
	}
</style>
