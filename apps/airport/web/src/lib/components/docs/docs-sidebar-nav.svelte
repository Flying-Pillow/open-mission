<script lang="ts">
	import type { DocsNavItem } from "$lib/docs/types";
	import { cn } from "$lib/utils";
	import DocsSidebarNav from "./docs-sidebar-nav.svelte";

	type Props = {
		nodes: DocsNavItem[];
		currentPath: string;
		depth?: number;
	};

	let { nodes, currentPath, depth = 0 }: Props = $props();

	function isCurrentPage(href: string): boolean {
		return normalizePath(currentPath) === normalizePath(href);
	}

	function isCurrentBranch(href: string): boolean {
		const normalizedHref = normalizePath(href);
		const normalizedCurrentPath = normalizePath(currentPath);

		return (
			normalizedCurrentPath === normalizedHref ||
			normalizedCurrentPath.startsWith(`${normalizedHref}/`)
		);
	}

	function normalizePath(pathname: string): string {
		return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
	}
</script>

<ul class={cn("grid gap-1", depth > 0 && "mt-1 border-l border-border/70 pl-3")}>
	{#each nodes as node (node.href)}
		<li class="grid gap-1">
			<a
				href={node.href}
				aria-current={isCurrentPage(node.href) ? "page" : undefined}
				class={cn(
					"rounded-xl px-3 py-2 text-sm transition-colors",
					isCurrentPage(node.href)
						? "bg-primary/10 font-semibold text-foreground"
						: isCurrentBranch(node.href)
							? "bg-muted/60 font-medium text-foreground"
							: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
				)}
			>
				{node.title}
			</a>

			{#if node.children.length > 0}
				<DocsSidebarNav
					nodes={node.children}
					{currentPath}
					depth={depth + 1}
				/>
			{/if}
		</li>
	{/each}
</ul>
