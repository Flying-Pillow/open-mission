<script lang="ts">
	import DocsContent from "$lib/components/docs/docs-content.svelte";
	import DocsPageHeader from "$lib/components/docs/docs-page-header.svelte";
	import {
		getDocsModulePath,
		type DocsMarkdownModule,
	} from "$lib/docs/manifest";
	import type { PageData } from "./$types";

	const docsModules = import.meta.glob("$docs/**/*.md", {
		eager: true,
	}) as Record<string, DocsMarkdownModule>;

	let { data }: { data: PageData } = $props();

	const PageComponent = $derived(resolvePageComponent(data.page.sourcePath));
	const documentTitle = $derived.by(() =>
		data.page.slug.length === 0
			? `${data.page.title} · Documentation`
			: `${data.page.title} · ${data.site.title} Documentation`,
	);

	function resolvePageComponent(sourcePath: string): DocsMarkdownModule["default"] {
		const modulePath = getDocsModulePath(sourcePath);
		const docsModule = docsModules[modulePath];

		if (!docsModule) {
			throw new Error(
				`No eager docs module exists for source "${sourcePath}".`,
			);
		}

		return docsModule.default;
	}
</script>

<svelte:head>
	<title>{documentTitle}</title>
	{#if data.page.description}
		<meta name="description" content={data.page.description} />
	{/if}
</svelte:head>

<section class="grid gap-6">
	<DocsPageHeader page={data.page} />

	<div class="rounded-3xl border bg-card/70 px-6 py-6 shadow-sm backdrop-blur-sm lg:px-8 lg:py-8">
		<DocsContent>
			<PageComponent />
		</DocsContent>
	</div>
</section>
