<!-- /apps/airport/web/src/lib/components/nav-user.svelte: GitHub-backed user menu with theme toggle and OAuth logout action. -->
<script lang="ts">
	import { mode, toggleMode } from "mode-watcher";
	import DotsVerticalIcon from "@tabler/icons-svelte/icons/dots-vertical";
	import LogoutIcon from "@tabler/icons-svelte/icons/logout";
	import MoonStarsIcon from "@tabler/icons-svelte/icons/moon-stars";
	import SunIcon from "@tabler/icons-svelte/icons/sun";
	import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
	import * as Avatar from "$lib/components/ui/avatar/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";

	let {
		user,
		logoutAction = "?/logout",
		contentSide,
		contentAlign = "end",
	}: {
		user: {
			name: string;
			email?: string;
			avatar: string;
			githubStatus?: "connected" | "disconnected" | "unknown";
		};
		logoutAction?: string;
		contentSide?: "top" | "right" | "bottom" | "left";
		contentAlign?: "start" | "center" | "end";
	} = $props();

	const sidebar = Sidebar.useSidebar();
	const dropdownSide = $derived(
		contentSide ?? (sidebar.isMobile ? "bottom" : "right"),
	);
	const userInitials = $derived.by(
		() =>
			user.name
				.split(/[^A-Za-z0-9]+/u)
				.filter((segment) => segment.length > 0)
				.slice(0, 2)
				.map((segment) => segment[0]?.toUpperCase() ?? "")
				.join("") || "GH",
	);
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						size="lg"
						class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					>
						<Avatar.Root class="size-8 rounded-lg grayscale">
							<Avatar.Image src={user.avatar} alt={user.name} />
							<Avatar.Fallback class="rounded-lg"
								>{userInitials}</Avatar.Fallback
							>
						</Avatar.Root>
						<div
							class="grid flex-1 text-start text-sm leading-tight"
						>
							<span class="truncate font-medium">{user.name}</span
							>
							{#if user.email}
								<span
									class="text-muted-foreground truncate text-xs"
								>
									{user.email}
								</span>
							{/if}
						</div>
						<DotsVerticalIcon class="ms-auto size-4" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				side={dropdownSide}
				align={contentAlign}
				sideOffset={4}
			>
				<DropdownMenu.Label class="p-0 font-normal">
					<div
						class="flex items-center gap-2 px-1 py-1.5 text-start text-sm"
					>
						<Avatar.Root class="size-8 rounded-lg">
							<Avatar.Image src={user.avatar} alt={user.name} />
							<Avatar.Fallback class="rounded-lg"
								>{userInitials}</Avatar.Fallback
							>
						</Avatar.Root>
						<div
							class="grid flex-1 text-start text-sm leading-tight"
						>
							<span class="truncate font-medium">{user.name}</span
							>
							{#if user.email}
								<span
									class="text-muted-foreground truncate text-xs"
								>
									{user.email}
								</span>
							{/if}
							<div
								class="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"
							>
								<BrandGithubIcon class="size-3" />
								<span
									>GitHub {user.githubStatus ??
										"unknown"}</span
								>
							</div>
						</div>
					</div>
				</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<DropdownMenu.Item onclick={toggleMode}>
						{#if mode.current === "dark"}
							<SunIcon />
							Light mode
						{:else}
							<MoonStarsIcon />
							Dark mode
						{/if}
					</DropdownMenu.Item>
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<form method="POST" action={logoutAction} class="w-full">
					<button
						type="submit"
						class="focus:bg-destructive/10 dark:focus:bg-destructive/20 text-destructive focus:text-destructive flex w-full cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-hidden"
					>
						<LogoutIcon class="size-4" />
						Log out
					</button>
				</form>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
