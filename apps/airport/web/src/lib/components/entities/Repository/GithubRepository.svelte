<script lang="ts">
    import { RepositoryDataSchema } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import type { RepositoryPlatformRepositoryType } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import { goto } from "$app/navigation";
    import Icon from "@iconify/svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import EntityClassCommandbar from "$lib/components/entities/Commandbar/EntityClassCommandbar.svelte";
    import { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";

    let {
        repository,
    }: {
        repository: RepositoryPlatformRepositoryType;
    } = $props();

    const appContext = getAppContext();
    const uid = $props.id();
    const defaultRepositoryPath = "/repositories";
    let detailsOpen = $state(false);
    let repositoryPath = $state(defaultRepositoryPath);
    let commandRefreshNonce = $state(0);
    const cloneTargetPath = $derived(
        `${repositoryPath.replace(/\/+$/u, "") || "/"}/${repository.repositoryRef}`,
    );
    const repositoryDescription = $derived(
        repository.description?.trim() ||
            repository.htmlUrl ||
            "No description available",
    );
    const repositoryLicense = $derived(
        repository.license?.spdxId &&
            repository.license.spdxId !== "NOASSERTION"
            ? repository.license.spdxId
            : repository.license?.name,
    );
    const activityMetrics = $derived(
        [
            { label: "Stars", value: repository.starsCount },
            { label: "Forks", value: repository.forksCount },
            { label: "Watchers", value: repository.watchersCount },
            { label: "Issues", value: repository.openIssuesCount },
        ].filter((metric) => metric.value !== undefined),
    );
    const repositoryClassCommands = $derived(
        appContext.application.repositoryClassCommands,
    );
    const repositoryClassCommandsLoading = $derived(
        appContext.application.repositoryClassCommandsLoading,
    );
    const repositoryClassCommandsError = $derived(
        appContext.application.repositoryClassCommandsError,
    );

    const commandInput = $derived({
        platform: "github" as const,
        repositoryRef: repository.repositoryRef,
        destinationPath: repositoryPath,
    });

    function handleUseRepository(): void {
        repositoryPath = defaultRepositoryPath;
        commandRefreshNonce += 1;
    }

    async function executeRepositoryClassCommand(
        commandId: string,
    ): Promise<void> {
        const data = RepositoryDataSchema.parse(
            await RepositoryEntity.executeClassCommand(commandId, commandInput),
        );
        const addedRepository =
            appContext.application.hydrateRepositoryData(data);
        await appContext.application.loadRepositories({ force: true });
        detailsOpen = false;
        await goto(`/airport/${encodeURIComponent(addedRepository.id)}`);
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
                    <Icon icon="lucide:github" class="size-4" />
                </span>
                <h3
                    class="min-w-0 truncate text-sm font-semibold text-foreground"
                >
                    {repository.repositoryRef}
                </h3>
                <Badge variant="outline">
                    {repository.visibility}
                </Badge>
                {#if repository.archived}
                    <Badge variant="secondary">Archived</Badge>
                {/if}
            </div>
            <p class="mt-2 text-sm text-muted-foreground">
                {repositoryDescription}
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
                {#each repository.topics.slice(0, 4) as topic (`${repository.repositoryRef}:${topic}`)}
                    <Badge variant="secondary">{topic}</Badge>
                {/each}
                {#if repositoryLicense}
                    <Badge variant="outline">{repositoryLicense}</Badge>
                {/if}
                {#if repository.defaultBranch}
                    <Badge variant="outline">{repository.defaultBranch}</Badge>
                {/if}
            </div>
        </div>

        <div class="flex flex-wrap gap-2 lg:justify-end">
            {#if repository.htmlUrl}
                <Button
                    href={repository.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Open ${repository.repositoryRef} on GitHub`}
                    title="Open on GitHub"
                >
                    <Icon icon="lucide:github" class="size-4" />
                </Button>
            {/if}
            <EntityClassCommandbar
                refreshNonce={commandRefreshNonce}
                entityName="Repository"
                {commandInput}
                commands={repositoryClassCommands}
                loading={repositoryClassCommandsLoading}
                loadError={repositoryClassCommandsError}
                executeCommand={executeRepositoryClassCommand}
                onCommandExecuted={async () => undefined}
                buttonClass="shadow-sm"
                showEmptyState={false}
            />
            <Dialog.Root bind:open={detailsOpen}>
                <Dialog.Trigger>
                    {#snippet child({ props })}
                        <Button
                            type="button"
                            size="sm"
                            onclick={handleUseRepository}
                            {...props}
                        >
                            Details
                            <Icon icon="lucide:arrow-right" class="size-4" />
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
                        <Dialog.Title>{repository.repositoryRef}</Dialog.Title>
                        <Dialog.Description>
                            {repositoryDescription}
                        </Dialog.Description>
                    </Dialog.Header>

                    <div class="grid gap-5">
                        <input
                            type="hidden"
                            name="platformRepositoryRef"
                            value={repository.repositoryRef}
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

                        {#if activityMetrics.length > 0}
                            <div class="grid gap-3 sm:grid-cols-4">
                                {#each activityMetrics as metric (metric.label)}
                                    <div
                                        class="rounded-2xl border bg-background/80 p-4"
                                    >
                                        <p
                                            class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                                        >
                                            {metric.label}
                                        </p>
                                        <p
                                            class="mt-2 text-sm font-semibold text-foreground"
                                        >
                                            {metric.value?.toLocaleString()}
                                        </p>
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <div class="rounded-3xl border bg-muted/40 p-4">
                            <p
                                class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground"
                            >
                                Full name
                            </p>
                            <p
                                class="mt-2 text-base font-semibold text-foreground"
                            >
                                {repository.repositoryRef}
                            </p>
                            <div class="mt-3 flex flex-wrap gap-2">
                                {#if repository.ownerType}
                                    <Badge variant="outline"
                                        >{repository.ownerType}</Badge
                                    >
                                {/if}
                                {#if repository.defaultBranch}
                                    <Badge variant="outline"
                                        >{repository.defaultBranch}</Badge
                                    >
                                {/if}
                                {#if repositoryLicense}
                                    <Badge variant="outline"
                                        >{repositoryLicense}</Badge
                                    >
                                {/if}
                            </div>
                            {#if repository.topics.length > 0}
                                <div class="mt-4 flex flex-wrap gap-2">
                                    {#each repository.topics as topic (`${repository.repositoryRef}:detail:${topic}`)}
                                        <Badge variant="secondary"
                                            >{topic}</Badge
                                        >
                                    {/each}
                                </div>
                            {/if}
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
                                        >
                                            Close
                                        </Button>
                                    {/snippet}
                                </Dialog.Close>
                                <EntityClassCommandbar
                                    refreshNonce={commandRefreshNonce}
                                    entityName="Repository"
                                    {commandInput}
                                    commands={repositoryClassCommands}
                                    loading={repositoryClassCommandsLoading}
                                    loadError={repositoryClassCommandsError}
                                    executeCommand={executeRepositoryClassCommand}
                                    onCommandExecuted={async () => undefined}
                                    buttonClass="shadow-sm"
                                    showEmptyState={false}
                                />
                            </div>
                        </Dialog.Footer>
                    </div>
                </Dialog.Content>
            </Dialog.Root>
        </div>
    </div>
</article>
