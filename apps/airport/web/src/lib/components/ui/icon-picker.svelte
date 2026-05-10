<script lang="ts">
    import { onMount } from "svelte";
    import Icon from "@iconify/svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    type IconifyCollection = {
        name?: string;
        total?: number;
        category?: string;
        displayHeight?: number;
        height?: number;
        license?: {
            title?: string;
            url?: string;
            spdx?: string;
        };
    };

    type IconifySearchResponse = {
        icons?: string[];
    };

    let {
        value = $bindable(""),
        label = "Repository icon",
        placeholder = "Search icons...",
        fallbackIcon = "lucide:folder-git-2",
    }: {
        value?: string;
        label?: string;
        placeholder?: string;
        fallbackIcon?: string;
    } = $props();

    let open = $state(false);
    let query = $state("");
    let icons = $state<string[]>([]);
    let collections = $state<Record<string, IconifyCollection>>({});
    let loading = $state(false);
    let collectionsLoading = $state(false);
    let loadError = $state<string | null>(null);

    const previewIcon = $derived(value.trim() || fallbackIcon);
    const groupedIcons = $derived.by(() => {
        const grouped: Record<
            string,
            { info?: IconifyCollection; icons: string[] }
        > = {};

        for (const icon of icons) {
            const [collectionName] = icon.split(":");
            if (!collectionName) {
                continue;
            }

            if (!grouped[collectionName]) {
                grouped[collectionName] = {
                    info: collections[collectionName],
                    icons: [],
                };
            }

            grouped[collectionName].icons.push(icon);
        }

        return Object.entries(grouped).sort(([left], [right]) =>
            left.localeCompare(right),
        );
    });

    async function loadCollections(): Promise<void> {
        collectionsLoading = true;
        try {
            const response = await fetch(
                "https://api.iconify.design/collections",
            );
            const payload = (await response.json()) as Record<
                string,
                IconifyCollection
            >;
            collections = payload;
        } catch (error) {
            loadError = error instanceof Error ? error.message : String(error);
        } finally {
            collectionsLoading = false;
        }
    }

    async function searchIcons(nextQuery: string): Promise<void> {
        query = nextQuery;
        const trimmedQuery = nextQuery.trim();
        if (!trimmedQuery) {
            icons = [];
            loadError = null;
            return;
        }

        loading = true;
        loadError = null;
        try {
            const response = await fetch(
                `https://api.iconify.design/search?query=${encodeURIComponent(trimmedQuery)}&limit=120`,
            );
            const payload = (await response.json()) as IconifySearchResponse;
            icons = payload.icons ?? [];
        } catch (error) {
            loadError = error instanceof Error ? error.message : String(error);
        } finally {
            loading = false;
        }
    }

    function handleOpenChange(nextOpen: boolean): void {
        open = nextOpen;
        if (nextOpen && !query && value.trim()) {
            void searchIcons(value.trim());
            return;
        }
        if (!nextOpen) {
            query = "";
            icons = [];
            loadError = null;
        }
    }

    function selectIcon(icon: string): void {
        value = icon;
        query = icon;
        handleOpenChange(false);
    }

    function clearIcon(): void {
        value = "";
        query = "";
        icons = [];
        loadError = null;
        handleOpenChange(false);
    }

    onMount(() => {
        void loadCollections();
    });
</script>

<div class="grid gap-3">
    <div class="flex flex-wrap items-center gap-2">
        <Dialog.Root
            bind:open
            onOpenChange={(nextOpen) => handleOpenChange(nextOpen)}
        >
            <Dialog.Trigger>
                {#snippet child({ props })}
                    <Button
                        type="button"
                        variant="outline"
                        class="h-auto min-h-12 justify-start gap-3 px-3 py-2"
                        {...props}
                    >
                        <span
                            class="inline-flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"
                        >
                            <Icon icon={previewIcon} class="size-5" />
                        </span>
                        <span class="text-sm font-medium">{label}</span>
                    </Button>
                {/snippet}
            </Dialog.Trigger>
            <Dialog.Content
                class="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col gap-0 overflow-hidden rounded-none p-0 md:h-[80dvh] md:max-h-[80dvh] md:w-full md:max-w-4xl md:rounded-4xl"
            >
                <Dialog.Header class="flex-none border-b px-6 py-4">
                    <Dialog.Title>{label}</Dialog.Title>
                    <Dialog.Description>
                        Search Iconify collections and choose the repository
                        icon.
                    </Dialog.Description>
                </Dialog.Header>

                <div
                    class="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5"
                >
                    <div class="flex flex-wrap items-center gap-2 pb-4">
                        <div class="relative min-w-0 flex-1">
                            <Icon
                                icon="lucide:search"
                                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                value={query}
                                oninput={(event) =>
                                    searchIcons(event.currentTarget.value)}
                                {placeholder}
                                class="pl-10"
                                spellcheck={false}
                                autocapitalize="none"
                                autocomplete="off"
                            />
                        </div>
                        {#if value.trim()}
                            <Button
                                type="button"
                                variant="ghost"
                                onclick={clearIcon}
                            >
                                <Icon icon="lucide:rotate-ccw" class="size-4" />
                                Reset
                            </Button>
                        {/if}
                    </div>

                    <ScrollArea class="min-h-0 flex-1 pr-3">
                        <div class="grid gap-5 pb-1">
                            {#if loadError}
                                <p class="text-sm text-rose-600">{loadError}</p>
                            {:else if loading}
                                <p class="text-sm text-muted-foreground">
                                    Searching icons...
                                </p>
                            {:else if collectionsLoading && groupedIcons.length === 0}
                                <p class="text-sm text-muted-foreground">
                                    Loading icon collections...
                                </p>
                            {:else if query.trim().length === 0}
                                <p class="text-sm text-muted-foreground">
                                    Search by collection or icon name, for
                                    example github, folder, or airplane.
                                </p>
                            {:else if groupedIcons.length === 0}
                                <p class="text-sm text-muted-foreground">
                                    No icons matched &quot;{query.trim()}&quot;.
                                </p>
                            {:else}
                                {#each groupedIcons as [collectionName, group] (collectionName)}
                                    <section class="grid gap-3">
                                        <div class="grid gap-1 border-b pb-2">
                                            <div
                                                class="flex flex-wrap items-center gap-x-3 gap-y-1"
                                            >
                                                <h3
                                                    class="text-sm font-semibold text-foreground"
                                                >
                                                    {group.info?.name ||
                                                        collectionName}
                                                </h3>
                                                <span
                                                    class="text-xs text-muted-foreground"
                                                >
                                                    {group.icons.length}
                                                    {group.info?.total
                                                        ? ` / ${group.info.total}`
                                                        : ""}
                                                    icons
                                                </span>
                                                {#if group.info?.category}
                                                    <span
                                                        class="text-xs text-muted-foreground"
                                                    >
                                                        {group.info.category}
                                                    </span>
                                                {/if}
                                            </div>
                                            {#if group.info?.license?.title}
                                                <p
                                                    class="text-xs text-muted-foreground"
                                                >
                                                    {group.info.license.title}
                                                </p>
                                            {/if}
                                        </div>
                                        <div
                                            class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
                                        >
                                            {#each group.icons as icon (icon)}
                                                <button
                                                    type="button"
                                                    class="flex min-h-24 flex-col items-center justify-between rounded-xl border bg-background px-2 py-3 text-center transition hover:border-primary/40 hover:bg-primary/5"
                                                    onclick={() =>
                                                        selectIcon(icon)}
                                                >
                                                    <Icon
                                                        {icon}
                                                        class="size-8"
                                                    />
                                                    <span
                                                        class="line-clamp-2 text-[11px] leading-4 text-muted-foreground"
                                                    >
                                                        {icon}
                                                    </span>
                                                </button>
                                            {/each}
                                        </div>
                                    </section>
                                {/each}
                            {/if}
                        </div>
                    </ScrollArea>
                </div>
            </Dialog.Content>
        </Dialog.Root>
    </div>
</div>
