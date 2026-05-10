<!-- /apps/airport/web/src/lib/components/airport/airport-sidebar.svelte: Sidebar frame for the Airport web surface, including optional GitHub user menu. -->
<script lang="ts">
    import { page } from "$app/state";
    import { asset } from "$app/paths";
    import Icon from "@iconify/svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import NavUser from "$lib/components/nav-user.svelte";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import {
        getRepositoryDisplayDescription,
        getRepositoryDisplayName,
        getRepositoryIconIdentifier,
    } from "$lib/components/entities/Repository/Repository.svelte.js";
    import type { ComponentProps } from "svelte";
    import type { MissionCatalogEntryType } from "@flying-pillow/mission-core/entities/Mission/MissionSchema";
    import type { SidebarRepositoryData } from "$lib/components/entities/types";

    type SidebarRepositoryView = SidebarRepositoryData & { id: string };

    const logo = asset("/logo.png");
    const appContext = getAppContext();

    const bottomMenu = [
        {
            title: "Settings",
            description: "Repository and Mission system source settings.",
            url: "https://github.com/Flying-Pillow/mission",
            icon: "lucide:settings",
        },
        {
            title: "Documentation",
            description:
                "Architecture, operator guidance, and reference material.",
            url: "/docs",
            icon: "lucide:book-open",
        },
        {
            title: "Search",
            description: "Search the Mission repository on GitHub.",
            url: "https://github.com/Flying-Pillow/mission/search",
            icon: "lucide:search",
        },
    ] satisfies {
        title: string;
        description: string;
        url: string;
        icon: string;
    }[];

    let { ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();

    const routeSegments = $derived(
        page.url.pathname.split("/").filter((segment) => segment.length > 0),
    );
    const activeRepositoryId = $derived(
        routeSegments[0] === "airport"
            ? decodeURIComponent(routeSegments[1] ?? "")
            : undefined,
    );
    const activeMissionId = $derived(
        routeSegments[0] === "airport"
            ? decodeURIComponent(routeSegments[2] ?? "")
            : appContext.airport.activeMissionId,
    );
    const showRepositoryNavigation = $derived(routeSegments[0] === "airport");

    const sidebarRepositories = $derived.by(() => {
        const repositories = (appContext?.airport.repositories ??
            []) as SidebarRepositoryView[];
        return repositories.map((repository) => {
            const isSelected = repository.id === activeRepositoryId;

            return {
                ...repository,
                displayName: getRepositoryDisplayName(repository),
                displayDescription: getRepositoryDisplayDescription(repository),
                icon: getRepositoryIconIdentifier(repository, "lucide:folder"),
                href: `/airport/${encodeURIComponent(repository.id)}`,
                missions: (repository.missions ?? []).map(
                    (mission: MissionCatalogEntryType) => ({
                        ...mission,
                        href: `/airport/${encodeURIComponent(repository.id)}/${encodeURIComponent(mission.missionId)}`,
                        isActive:
                            isSelected && mission.missionId === activeMissionId,
                    }),
                ),
            };
        });
    });
</script>

<Sidebar.Root
    collapsible="icon"
    class="border-sidebar-border/70 bg-foreground/10 [&>[data-slot=sidebar-inner]]:bg-transparent"
    {...restProps}
>
    <Sidebar.Header class="items-center px-3 py-4">
        <Sidebar.Menu>
            <Sidebar.MenuItem>
                <Sidebar.MenuButton
                    class="mx-auto size-14 justify-center rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-0! shadow-sm group-data-[collapsible=icon]:size-14! group-data-[collapsible=icon]:p-0! [&_svg]:size-6"
                    tooltipContent="Airport"
                    tooltipContentProps={{
                        sideOffset: 14,
                        class: "border border-border bg-popover px-4 py-3 text-popover-foreground shadow-xl",
                    }}
                >
                    {#snippet child({ props })}
                        <a href="/airport" {...props}>
                            <img
                                src={logo}
                                alt="Flying-Pillow logo"
                                class="size-10 shrink-0 rounded-md object-contain"
                            />
                            <span
                                class="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden"
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

    <Sidebar.Content class="gap-3 px-3 pb-3">
        {#if showRepositoryNavigation}
            <Sidebar.Group class="min-h-0 px-0">
                <Sidebar.GroupLabel
                    class="px-2 group-data-[collapsible=icon]:sr-only"
                    >Repositories</Sidebar.GroupLabel
                >
                <Sidebar.GroupContent>
                    <Sidebar.Menu class="gap-2">
                        {#if sidebarRepositories.length === 0}
                            <Sidebar.MenuItem>
                                <div
                                    class="text-muted-foreground px-2 py-1.5 text-xs group-data-[collapsible=icon]:sr-only"
                                >
                                    No repositories available
                                </div>
                            </Sidebar.MenuItem>
                        {:else}
                            {#each sidebarRepositories as repository (repository.id)}
                                <Sidebar.MenuItem>
                                    <Sidebar.MenuButton
                                        class="h-auto min-h-14 rounded-xl border border-transparent px-3 py-3 data-[active=true]:border-foreground/20 data-[active=true]:bg-foreground/20 data-[active=true]:shadow-sm group-data-[collapsible=icon]:size-14! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! [&_svg]:size-6"
                                        isActive={repository.id ===
                                            activeRepositoryId}
                                        tooltipContentProps={{
                                            sideOffset: 14,
                                            class: "w-80 max-w-80 border border-border bg-popover px-4 py-4 text-popover-foreground shadow-xl",
                                        }}
                                    >
                                        {#snippet child({ props })}
                                            <a
                                                href={repository.href}
                                                {...props}
                                            >
                                                <Icon
                                                    icon={repository.icon}
                                                    class="text-muted-foreground group-data-[active=true]/menu-button:text-foreground"
                                                />
                                                <span
                                                    class="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden"
                                                >
                                                    <span
                                                        class="truncate text-sm font-medium"
                                                        >{repository.displayName}</span
                                                    >
                                                    <span
                                                        class="text-muted-foreground truncate text-xs"
                                                    >
                                                        {repository.displayDescription}
                                                    </span>
                                                </span>
                                            </a>
                                        {/snippet}
                                        {#snippet tooltipContent()}
                                            <div
                                                class="grid min-w-0 gap-3 text-left"
                                            >
                                                <div
                                                    class="flex items-start gap-3"
                                                >
                                                    <span
                                                        class="inline-flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-primary"
                                                    >
                                                        <Icon
                                                            icon={repository.icon}
                                                            class="size-5"
                                                        />
                                                    </span>
                                                    <div class="min-w-0">
                                                        <p
                                                            class="truncate text-sm font-semibold text-foreground"
                                                        >
                                                            {repository.displayName}
                                                        </p>
                                                        <p
                                                            class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground"
                                                        >
                                                            {repository.displayDescription}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div
                                                    class="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground"
                                                >
                                                    <span>Local repository</span
                                                    >
                                                    <span
                                                        >{repository.missions
                                                            .length}
                                                        {repository.missions
                                                            .length === 1
                                                            ? "mission"
                                                            : "missions"}</span
                                                    >
                                                </div>
                                            </div>
                                        {/snippet}
                                    </Sidebar.MenuButton>

                                    {#if repository.missions.length > 0}
                                        <Sidebar.MenuSub
                                            class="group-data-[collapsible=icon]:hidden"
                                        >
                                            {#each repository.missions as mission (mission.missionId)}
                                                <Sidebar.MenuSubItem>
                                                    <Sidebar.MenuSubButton
                                                        isActive={mission.isActive}
                                                    >
                                                        {#snippet child({
                                                            props,
                                                        })}
                                                            <a
                                                                href={mission.href}
                                                                {...props}
                                                            >
                                                                <Icon
                                                                    icon="lucide:calendar"
                                                                />
                                                                <span>
                                                                    {mission.title?.trim() ||
                                                                        mission.missionId}
                                                                </span>
                                                            </a>
                                                        {/snippet}
                                                    </Sidebar.MenuSubButton>
                                                </Sidebar.MenuSubItem>
                                            {/each}
                                        </Sidebar.MenuSub>
                                    {/if}
                                </Sidebar.MenuItem>
                            {/each}
                        {/if}
                    </Sidebar.Menu>
                </Sidebar.GroupContent>
            </Sidebar.Group>
        {/if}
    </Sidebar.Content>

    <Sidebar.Footer class="gap-2 px-3 pb-4">
        <Sidebar.Group class="px-0">
            <Sidebar.GroupContent>
                <Sidebar.Menu class="gap-2">
                    {#each bottomMenu as item (item.title)}
                        <Sidebar.MenuItem>
                            <Sidebar.MenuButton
                                class="h-12 rounded-xl border border-transparent px-3 group-data-[collapsible=icon]:size-14! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0! [&_svg]:size-6"
                                tooltipContentProps={{
                                    sideOffset: 14,
                                    class: "w-72 max-w-72 border border-border bg-popover px-4 py-4 text-popover-foreground shadow-xl",
                                }}
                            >
                                {#snippet child({ props })}
                                    <a href={item.url} {...props}>
                                        <Icon icon={item.icon} />
                                        <span
                                            class="group-data-[collapsible=icon]:hidden"
                                            >{item.title}</span
                                        >
                                    </a>
                                {/snippet}
                                {#snippet tooltipContent()}
                                    <div class="grid gap-1.5 text-left">
                                        <p
                                            class="text-sm font-semibold text-foreground"
                                        >
                                            {item.title}
                                        </p>
                                        <p
                                            class="text-xs leading-5 text-muted-foreground"
                                        >
                                            {item.description}
                                        </p>
                                    </div>
                                {/snippet}
                            </Sidebar.MenuButton>
                        </Sidebar.MenuItem>
                    {/each}
                </Sidebar.Menu>
            </Sidebar.GroupContent>
        </Sidebar.Group>
        <NavUser compact contentSide="right" contentAlign="end" />
    </Sidebar.Footer>
</Sidebar.Root>
