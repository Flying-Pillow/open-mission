<!-- /apps/airport/web/src/lib/components/nav-user.svelte: GitHub-backed user menu with theme toggle and OAuth logout action. -->
<script lang="ts">
	import { page } from "$app/state";
	import { asset } from "$app/paths";
	import { mode, toggleMode } from "mode-watcher";
	import Icon from "@iconify/svelte";
	import * as Avatar from "$lib/components/ui/avatar/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { getAppContext } from "$lib/client/context/app-context.svelte";

	let {
		logoutAction = "/login?/clearGithubToken",
		contentSide,
		contentAlign = "end",
		compact = false,
		avatarOnly = false,
	}: {
		logoutAction?: string;
		contentSide?: "top" | "right" | "bottom" | "left";
		contentAlign?: "start" | "center" | "end";
		compact?: boolean;
		avatarOnly?: boolean;
	} = $props();

	const appContext = getAppContext();
	const sidebar = Sidebar.useSidebar();
	const fallbackAvatar = asset("/logo.png");
	const redirectTo = $derived(`${page.url.pathname}${page.url.search}`);
	const loginHref = $derived(
		`/login?redirectTo=${encodeURIComponent(redirectTo)}`,
	);
	const githubStatus = $derived(
		appContext.user?.githubStatus ?? appContext.githubStatus,
	);
	const isGithubConnected = $derived(githubStatus === "connected");
	const displayName = $derived(
		appContext.user?.name?.trim() ||
			(isGithubConnected ? "GitHub" : "Not signed in"),
	);
	const displayEmail = $derived(appContext.user?.email?.trim());
	const avatar = $derived(appContext.user?.avatarUrl ?? fallbackAvatar);
	const dropdownSide = $derived(
		contentSide ?? (sidebar.isMobile ? "bottom" : "right"),
	);
	const userInitials = $derived.by(
		() =>
			displayName
				.split(/[^A-Za-z0-9]+/u)
				.filter((segment) => segment.length > 0)
				.slice(0, 2)
				.map((segment) => segment[0]?.toUpperCase() ?? "")
				.join("") || "GH",
	);
</script>

<DropdownMenu.Root>
	{#if avatarOnly}
		<DropdownMenu.Trigger
			class="inline-flex size-9 items-center justify-center rounded-full border border-transparent transition-colors hover:border-border hover:bg-muted/60 data-[state=open]:border-border data-[state=open]:bg-muted/80"
			aria-label={`Open user menu for ${displayName}`}
			title={displayName}
		>
			<Avatar.Root class="size-8 rounded-full grayscale">
				<Avatar.Image src={avatar} alt={displayName} />
				<Avatar.Fallback class="rounded-full"
					>{userInitials}</Avatar.Fallback
				>
			</Avatar.Root>
		</DropdownMenu.Trigger>
	{:else}
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Sidebar.MenuButton
							{...props}
							size="lg"
							class={compact
								? "h-12 rounded-xl border border-transparent px-3 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-14! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
								: "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"}
						>
							<Avatar.Root
								class={compact
									? "size-10 rounded-lg grayscale"
									: "size-8 rounded-lg grayscale"}
							>
								<Avatar.Image src={avatar} alt={displayName} />
								<Avatar.Fallback class="rounded-lg"
									>{userInitials}</Avatar.Fallback
								>
							</Avatar.Root>
							<div
								class={compact
									? "grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden"
									: "grid flex-1 text-start text-sm leading-tight"}
							>
								<span class="truncate font-medium"
									>{displayName}</span
								>
								{#if displayEmail}
									<span
										class="text-muted-foreground truncate text-xs"
									>
										{displayEmail}
									</span>
								{/if}
							</div>
							<Icon
								icon="lucide:ellipsis-vertical"
								class={compact
									? "ms-auto size-4 group-data-[collapsible=icon]:hidden"
									: "ms-auto size-4"}
							/>
						</Sidebar.MenuButton>
					{/snippet}
				</DropdownMenu.Trigger>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	{/if}
	<DropdownMenu.Content
		class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
		side={dropdownSide}
		align={contentAlign}
		sideOffset={4}
	>
		<DropdownMenu.Label class="p-0 font-normal">
			<div class="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
				<Avatar.Root class="size-8 rounded-lg">
					<Avatar.Image src={avatar} alt={displayName} />
					<Avatar.Fallback class="rounded-lg"
						>{userInitials}</Avatar.Fallback
					>
				</Avatar.Root>
				<div class="grid flex-1 text-start text-sm leading-tight">
					<span class="truncate font-medium">{displayName}</span>
					{#if displayEmail}
						<span class="text-muted-foreground truncate text-xs">
							{displayEmail}
						</span>
					{/if}
					<div
						class="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"
					>
						<Icon icon="lucide:github" class="size-3" />
						<span>GitHub {githubStatus}</span>
					</div>
				</div>
			</div>
		</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<DropdownMenu.Group>
			<DropdownMenu.Item onclick={toggleMode}>
				{#if mode.current === "dark"}
					<Icon icon="lucide:sun" />
					Light mode
				{:else}
					<Icon icon="lucide:moon" />
					Dark mode
				{/if}
			</DropdownMenu.Item>
		</DropdownMenu.Group>
		<DropdownMenu.Separator />
		{#if isGithubConnected}
			<form method="POST" action={logoutAction} class="w-full">
				<input type="hidden" name="redirect_to" value={redirectTo} />
				<button
					type="submit"
					class="focus:bg-destructive/10 dark:focus:bg-destructive/20 text-destructive focus:text-destructive flex w-full cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-hidden"
				>
					<Icon icon="lucide:log-out" class="size-4" />
					Log out
				</button>
			</form>
		{:else}
			<a
				href={loginHref}
				class="focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
			>
				<Icon icon="lucide:log-in" />
				Log in with GitHub
			</a>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
