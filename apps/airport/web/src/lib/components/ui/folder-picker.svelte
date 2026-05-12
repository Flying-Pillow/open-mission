<script lang="ts">
    import Icon from "@iconify/svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import * as InputGroup from "$lib/components/ui/input-group/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    type DirectoryEntry = {
        name: string;
        path: string;
    };

    type DirectoryListingResponse = {
        currentPath: string;
        parentPath: string | null;
        entries: DirectoryEntry[];
        error?: string;
    };

    let {
        id,
        value = $bindable(""),
        placeholder = "/home/user/repositories",
        browseLabel = "Browse",
        helperText = "Browse the server filesystem and select a folder.",
    }: {
        id?: string;
        value?: string;
        placeholder?: string;
        browseLabel?: string;
        helperText?: string;
    } = $props();

    let pickerOpen = $state(false);
    let loading = $state(false);
    let pickerError = $state<string | null>(null);
    let currentPath = $state("");
    let parentPath = $state<string | null>(null);
    let entries = $state<DirectoryEntry[]>([]);

    const normalizedValue = $derived(value.trim());
    const activePickerPath = $derived(currentPath || normalizedValue || "/");

    function isSelectedPath(pathValue: string): boolean {
        return normalizedValue === pathValue;
    }

    async function loadDirectory(targetPath: string): Promise<void> {
        loading = true;
        pickerError = null;
        try {
            const response = await fetch(
                `/api/system/directories?path=${encodeURIComponent(targetPath)}`,
                { headers: { accept: "application/json" } },
            );
            const payload = (await response.json()) as DirectoryListingResponse;
            if (!response.ok) {
                throw new Error(
                    payload.error ?? "Folder picker is unavailable.",
                );
            }

            currentPath = payload.currentPath;
            parentPath = payload.parentPath;
            entries = payload.entries;
        } catch (error) {
            pickerError =
                error instanceof Error ? error.message : String(error);
        } finally {
            loading = false;
        }
    }

    async function togglePicker(): Promise<void> {
        pickerOpen = !pickerOpen;
        if (!pickerOpen) {
            pickerError = null;
            return;
        }

        await loadDirectory("/");
    }

    async function handleOpenChange(nextOpen: boolean): Promise<void> {
        pickerOpen = nextOpen;
        if (!nextOpen) {
            pickerError = null;
            return;
        }

        await loadDirectory("/");
    }

    function choosePath(pathValue: string): void {
        value = pathValue;
        pickerOpen = false;
    }
</script>

<div class="grid gap-3">
    <InputGroup.Root>
        <InputGroup.Addon align="inline-start">
            <Icon
                icon="lucide:folder-tree"
                class="size-4 text-muted-foreground"
            />
        </InputGroup.Addon>
        <InputGroup.Input
            {id}
            bind:value
            {placeholder}
            spellcheck={false}
            autocapitalize="none"
            autocomplete="off"
        />
        <InputGroup.Button
            size="sm"
            variant="outline"
            onclick={togglePicker}
            aria-expanded={pickerOpen}
        >
            <Icon
                icon={pickerOpen ? "lucide:chevron-up" : "lucide:folder-open"}
                class="size-4"
            />
            {browseLabel}
        </InputGroup.Button>
    </InputGroup.Root>

    <Dialog.Root
        bind:open={pickerOpen}
        onOpenChange={(nextOpen) => void handleOpenChange(nextOpen)}
    >
        <Dialog.Content
            class="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col gap-0 overflow-hidden rounded-none p-0 md:h-[80dvh] md:max-h-[80dvh] md:w-full md:max-w-3xl md:rounded-4xl"
        >
            <Dialog.Header class="flex-none border-b px-6 py-4">
                <Dialog.Title>Choose Repositories Root</Dialog.Title>
                <Dialog.Description>
                    Browse the runtime filesystem and select the folder to use
                    as the system repositories root.
                </Dialog.Description>
            </Dialog.Header>

            <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
                <div
                    class="flex flex-wrap items-start justify-between gap-3 border-b pb-4"
                >
                    <div class="min-w-0 flex-1">
                        <p
                            class="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                        >
                            Current folder
                        </p>
                        <p
                            class="mt-1 truncate text-sm font-medium text-foreground"
                        >
                            {activePickerPath}
                        </p>
                        <p class="mt-1 text-xs text-muted-foreground">
                            {helperText}
                        </p>
                    </div>

                    <div class="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={!parentPath || loading}
                            onclick={() =>
                                parentPath && loadDirectory(parentPath)}
                            title="Open parent folder"
                        >
                            <Icon icon="lucide:arrow-up" class="size-3.5" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={loading}
                            onclick={() => loadDirectory(activePickerPath)}
                            title="Refresh folder"
                        >
                            <Icon icon="lucide:refresh-cw" class="size-3.5" />
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={loading}
                            onclick={() => choosePath(activePickerPath)}
                        >
                            Use this folder
                        </Button>
                    </div>
                </div>

                <ScrollArea class="min-h-0 flex-1 pt-4">
                    <div class="grid gap-1 pb-1">
                        {#if pickerError}
                            <p class="px-2 py-2 text-sm text-rose-600">
                                {pickerError}
                            </p>
                        {:else if loading}
                            <p class="px-2 py-2 text-sm text-muted-foreground">
                                Loading folders...
                            </p>
                        {:else if entries.length === 0}
                            <p class="px-2 py-2 text-sm text-muted-foreground">
                                No child folders found.
                            </p>
                        {:else}
                            {#each entries as entry (entry.path)}
                                <div
                                    class="flex items-center gap-2 rounded-xl border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-muted/50"
                                >
                                    <button
                                        type="button"
                                        class="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        onclick={() =>
                                            loadDirectory(entry.path)}
                                    >
                                        <span
                                            class="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border bg-background text-muted-foreground"
                                        >
                                            <Icon
                                                icon="lucide:folder"
                                                class="size-4"
                                            />
                                        </span>
                                        <span class="min-w-0 flex-1">
                                            <span
                                                class="block truncate text-sm font-medium text-foreground"
                                            >
                                                {entry.name}
                                            </span>
                                            <span
                                                class="block truncate text-xs text-muted-foreground"
                                            >
                                                {entry.path}
                                            </span>
                                        </span>
                                    </button>

                                    {#if isSelectedPath(entry.path)}
                                        <span
                                            class="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary"
                                            title={`${entry.name} is selected`}
                                            aria-label={`${entry.name} is selected`}
                                        >
                                            <Icon
                                                icon="lucide:check"
                                                class="size-3.5"
                                            />
                                        </span>
                                    {:else}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="xs"
                                            class="text-muted-foreground hover:text-foreground"
                                            onclick={() =>
                                                choosePath(entry.path)}
                                            title={`Select ${entry.name}`}
                                        >
                                            Select
                                        </Button>
                                    {/if}
                                </div>
                            {/each}
                        {/if}
                    </div>
                </ScrollArea>
            </div>
        </Dialog.Content>
    </Dialog.Root>
</div>
