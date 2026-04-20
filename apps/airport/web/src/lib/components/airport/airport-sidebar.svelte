<!-- /apps/airport/web/src/lib/components/airport/airport-sidebar.svelte: Sidebar frame for the Airport web surface, including optional GitHub user menu. -->
<script lang="ts">
    import { page } from "$app/state";
    import { asset } from "$app/paths";
    import CalendarIcon from "@tabler/icons-svelte/icons/calendar";
    import ChevronRightIcon from "@tabler/icons-svelte/icons/chevron-right";
    import DashboardIcon from "@tabler/icons-svelte/icons/dashboard";
    import FolderIcon from "@tabler/icons-svelte/icons/folder";
    import HelpIcon from "@tabler/icons-svelte/icons/help";
    import SearchIcon from "@tabler/icons-svelte/icons/search";
    import SettingsIcon from "@tabler/icons-svelte/icons/settings";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import NavSecondary from "$lib/components/nav-secondary.svelte";
    import NavUser from "$lib/components/nav-user.svelte";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import type { Icon } from "@tabler/icons-svelte";
    import type { ComponentProps } from "svelte";

    const logo = asset("/logo.png");
    const appContext = getAppContext();

    const bottomMenu = [
        {
            title: "Settings",
            url: "https://github.com/Flying-Pillow/mission",
            icon: SettingsIcon,
        },
        {
            title: "Get Help",
            url: "https://github.com/Flying-Pillow/mission/issues",
            icon: HelpIcon,
        },
        {
            title: "Search",
            url: "https://github.com/Flying-Pillow/mission/search",
            icon: SearchIcon,
        },
    ] satisfies { title: string; url: string; icon: Icon }[];

    let { ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();

    const workspaceUser = $derived.by(() => {
        if (!appContext?.user?.name) {
            return undefined;
        }

        return {
            name: appContext.user.name,
            ...(appContext.user.email ? { email: appContext.user.email } : {}),
            githubStatus: appContext.user.githubStatus,
            avatar: appContext.user.avatarUrl ?? logo,
        };
    });

    const routeSegments = $derived(
        page.url.pathname.split("/").filter((segment) => segment.length > 0),
    );
    const activeRepositoryId = $derived(
        routeSegments[0] === "repository"
            ? decodeURIComponent(routeSegments[1] ?? "")
            : undefined,
    );

    const sidebarRepositories = $derived.by(() => {
        return (appContext?.airport.repositories ?? []).map((repository) => {
            const isSelected = repository.repositoryId === activeRepositoryId;

            return {
                ...repository,
                icon: (isSelected ? DashboardIcon : FolderIcon) satisfies Icon,
                href: `/repository/${encodeURIComponent(repository.repositoryId)}`,
            };
        });
    });
</script>

<Sidebar.Root collapsible="offcanvas" {...restProps}>
    <Sidebar.Header>
        <Sidebar.Menu>
            <Sidebar.MenuItem>
                <Sidebar.MenuButton
                    class="data-[slot=sidebar-menu-button]:!p-1.5"
                >
                    {#snippet child({ props })}
                        <a href="/" {...props}>
                            <img
                                src={logo}
                                alt="Flying-Pillow logo"
                                class="size-8 shrink-0 rounded-md object-contain"
                            />
                            <span
                                class="grid flex-1 text-left text-sm leading-tight"
                            >
                                <span class="font-semibold">Airport</span>
                                <span class="text-muted-foreground text-xs"
                                    >Flying-Pillow Mission</span
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
            <Sidebar.GroupLabel>Repositories</Sidebar.GroupLabel>
            <Sidebar.GroupContent>
                <Sidebar.Menu>
                    {#if sidebarRepositories.length === 0}
                        <Sidebar.MenuItem>
                            <div
                                class="text-muted-foreground px-2 py-1.5 text-xs"
                            >
                                No repositories available
                            </div>
                        </Sidebar.MenuItem>
                    {:else}
                        {#each sidebarRepositories as repository (repository.repositoryId)}
                            <Sidebar.MenuItem>
                                <Sidebar.MenuButton class="h-auto py-2">
                                    {#snippet child({ props })}
                                        <a href={repository.href} {...props}>
                                            <repository.icon />
                                            <span
                                                class="grid min-w-0 flex-1 text-left leading-tight"
                                            >
                                                <span
                                                    class="truncate text-sm font-medium"
                                                    >{repository.label}</span
                                                >
                                                <span
                                                    class="text-muted-foreground truncate text-xs"
                                                >
                                                    {repository.description}
                                                </span>
                                            </span>
                                        </a>
                                    {/snippet}
                                </Sidebar.MenuButton>
                            </Sidebar.MenuItem>
                        {/each}
                    {/if}
                </Sidebar.Menu>
            </Sidebar.GroupContent>
        </Sidebar.Group>

        <NavSecondary items={bottomMenu} class="mt-auto" />
    </Sidebar.Content>

    {#if workspaceUser}
        <Sidebar.Footer>
            <NavUser user={workspaceUser} />
        </Sidebar.Footer>
    {/if}
</Sidebar.Root>
