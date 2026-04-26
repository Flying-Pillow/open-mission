<script lang="ts">
    import ArrowRightIcon from "@tabler/icons-svelte/icons/arrow-right";
    import BrandGithubIcon from "@tabler/icons-svelte/icons/brand-github";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import type { GitHubVisibleRepositorySummary } from "$lib/components/entities/types";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";

    let {
        repository,
    }: {
        repository: GitHubVisibleRepositorySummary;
    } = $props();

    const appContext = getAppContext();
    const uid = $props.id();
    const defaultRepositoryPath = "/repositories";
    let detailsOpen = $state(false);
    let repositoryPath = $state(defaultRepositoryPath);
    const addRepositoryState = $derived(
        appContext.application.addRepositoryState,
    );
    const addRepositoryPending = $derived(
        appContext.application.addRepositoryPending,
    );
    const cloneTargetPath = $derived(
        `${repositoryPath.replace(/\/+$/u, "") || "/"}/${repository.fullName}`,
    );

    const cloneState = $derived(
        addRepositoryState?.githubRepository === repository.fullName
            ? addRepositoryState
            : undefined,
    );

    function handleUseRepository(): void {
        repositoryPath = cloneState?.repositoryPath ?? defaultRepositoryPath;
    }

    async function handleClone(event: SubmitEvent): Promise<void> {
        event.preventDefault();

        try {
            await appContext.application.addRepository({
                repositoryPath,
                githubRepository: repository.fullName,
            });
        } catch {
            return;
        }
    }
</script>

<article
    class="rounded-lg border bg-card px-4 py-4 shadow-xs transition-colors hover:bg-muted/20"
>
    <div
        class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
    >
        <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
                <span
                    class="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground"
                >
                    <BrandGithubIcon class="size-4" />
                </span>
                <h3
                    class="min-w-0 truncate text-sm font-semibold text-foreground"
                >
                    {repository.fullName}
                </h3>
                <Badge variant="outline">
                    {repository.visibility}
                </Badge>
                {#if repository.archived}
                    <Badge variant="secondary">Archived</Badge>
                {/if}
            </div>
            <p class="mt-2 text-sm text-muted-foreground">
                {repository.ownerLogin ?? "GitHub repository"}
            </p>
            <p class="mt-1 font-mono text-xs text-muted-foreground">
                {repository.htmlUrl ?? "URL unavailable"}
            </p>
        </div>

        <div class="flex flex-wrap gap-2 lg:justify-end">
            <Dialog.Root bind:open={detailsOpen}>
                <Dialog.Trigger>
                    {#snippet child({ props })}
                        <Button
                            type="button"
                            size="sm"
                            onclick={handleUseRepository}
                            {...props}
                        >
                            Use repository
                            <ArrowRightIcon class="size-4" />
                        </Button>
                    {/snippet}
                </Dialog.Trigger>
                <Dialog.Content class="sm:max-w-xl">
                    <Dialog.Header class="gap-3 pr-10">
                        <div class="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">GitHub</Badge>
                            <Badge
                                variant={repository.visibility === "private"
                                    ? "secondary"
                                    : "outline"}
                            >
                                {repository.visibility}
                            </Badge>
                            {#if repository.archived}
                                <Badge variant="secondary">Archived</Badge>
                            {/if}
                        </div>
                        <Dialog.Title>{repository.fullName}</Dialog.Title>
                        <Dialog.Description>
                            Review the repository details and choose where
                            Airport should clone it on the daemon host.
                        </Dialog.Description>
                    </Dialog.Header>

                    <form class="grid gap-5" onsubmit={handleClone}>
                        <input
                            type="hidden"
                            name="githubRepository"
                            value={repository.fullName}
                        />

                        <div class="grid gap-3 sm:grid-cols-2">
                            <div
                                class="rounded-2xl border bg-background/80 p-4"
                            >
                                <p
                                    class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                                >
                                    Owner
                                </p>
                                <p
                                    class="mt-2 text-sm font-medium text-foreground"
                                >
                                    {repository.ownerLogin ?? "Unavailable"}
                                </p>
                            </div>
                            <div
                                class="rounded-2xl border bg-background/80 p-4"
                            >
                                <p
                                    class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                                >
                                    Status
                                </p>
                                <p
                                    class="mt-2 text-sm font-medium text-foreground"
                                >
                                    {repository.archived
                                        ? "Archived repository"
                                        : "Active repository"}
                                </p>
                            </div>
                        </div>

                        <div class="rounded-3xl border bg-muted/40 p-4">
                            <p
                                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                            >
                                Full name
                            </p>
                            <p
                                class="mt-2 text-base font-semibold text-foreground"
                            >
                                {repository.fullName}
                            </p>
                            <Separator class="my-4" />
                            <p
                                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                            >
                                Remote URL
                            </p>
                            <p
                                class="mt-2 break-all font-mono text-xs text-muted-foreground"
                            >
                                {repository.htmlUrl ?? "URL unavailable"}
                            </p>
                        </div>

                        <div class="grid gap-2">
                            <label
                                class="text-sm font-medium text-foreground"
                                for={`${uid}-repository-path`}
                            >
                                Clone base folder
                            </label>
                            <Input
                                id={`${uid}-repository-path`}
                                name="repositoryPath"
                                placeholder="/repositories"
                                bind:value={repositoryPath}
                            />
                            <p class="text-sm text-muted-foreground">
                                Airport sends this absolute base folder to the
                                daemon, which then clones into:
                                <span
                                    class="mt-1 block font-mono text-xs text-foreground"
                                >
                                    {cloneTargetPath}
                                </span>
                            </p>
                        </div>

                        {#if cloneState?.error}
                            <p class="text-sm text-rose-600">
                                {cloneState.error}
                            </p>
                        {/if}

                        {#if cloneState?.success}
                            <p class="text-sm text-emerald-600">
                                Repository ready: {cloneState.repositoryPath}
                            </p>
                        {/if}

                        <Dialog.Footer class="pt-2 sm:justify-between">
                            {#if repository.htmlUrl}
                                <Button
                                    href={repository.htmlUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    variant="outline"
                                >
                                    Open on GitHub
                                </Button>
                            {:else}
                                <span class="text-sm text-muted-foreground">
                                    GitHub URL is not available for this
                                    repository.
                                </span>
                            {/if}
                            <div class="flex flex-wrap gap-2">
                                <Dialog.Close>
                                    {#snippet child({ props })}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            {...props}
                                            disabled={addRepositoryPending}
                                        >
                                            Close
                                        </Button>
                                    {/snippet}
                                </Dialog.Close>
                                <Button
                                    type="submit"
                                    disabled={addRepositoryPending}
                                >
                                    {addRepositoryPending
                                        ? "Cloning repository..."
                                        : "Clone repository"}
                                </Button>
                            </div>
                        </Dialog.Footer>
                    </form>
                </Dialog.Content>
            </Dialog.Root>
        </div>
    </div>
</article>
