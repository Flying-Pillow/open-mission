<script lang="ts">
	import { page } from "$app/state";
	import { asset } from "$app/paths";
	import Icon from "@iconify/svelte";
	import type { DocsNavItem, DocsSiteMeta } from "$lib/docs/types";
	import DocsSidebarNav from "./docs-sidebar-nav.svelte";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import type { ComponentProps } from "svelte";

	type Props = {
		navigation: DocsNavItem[];
		site: DocsSiteMeta;
	} & ComponentProps<typeof Sidebar.Root>;

	const missionRepositoryUrl = "https://github.com/Flying-Pillow/mission";
	const logo = asset("/logo.png");

	let { navigation, site, ...restProps }: Props = $props();
</script>

<Sidebar.Root collapsible="offcanvas" {...restProps}>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton
					class="data-[slot=sidebar-menu-button]:!h-auto data-[slot=sidebar-menu-button]:!p-1.5"
				>
					{#snippet child({ props })}
						<a href="/docs" {...props}>
							<img
								src={logo}
								alt="Flying-Pillow logo"
								class="size-8 shrink-0 rounded-md object-contain"
							/>
							<span
								class="grid min-w-0 flex-1 text-left text-sm leading-tight"
							>
								<span
									class="text-[0.7rem] font-medium uppercase tracking-[0.24em] text-muted-foreground"
								>
									Documentation
								</span>
								<span class="truncate font-semibold"
									>{site.title}</span
								>
							</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Navigate docs</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<nav
					aria-label="Documentation navigation"
					class="grid gap-4 px-2 pb-2"
				>
					<DocsSidebarNav
						nodes={navigation}
						currentPath={page.url.pathname}
					/>
				</nav>
			</Sidebar.GroupContent>
		</Sidebar.Group>

		<Sidebar.Group class="mt-auto">
			<Sidebar.GroupLabel>Links</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<div class="grid gap-2 px-2 pb-2 text-sm">
					<a
						href="/"
						class="rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-foreground transition-colors hover:bg-muted/60"
					>
						Airport home
					</a>
					<a
						href={missionRepositoryUrl}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-foreground transition-colors hover:bg-muted/60"
					>
						<Icon icon="lucide:github" class="size-4" />
						<span>Mission on GitHub</span>
					</a>
				</div>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
</Sidebar.Root>
