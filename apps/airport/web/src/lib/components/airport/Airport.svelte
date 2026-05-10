<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import Icon from "@iconify/svelte";
    import { getRepositoryIconIdentifier } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import { Repository as RepositoryEntity } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { RepositoryDataSchema } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import { toast } from "svelte-sonner";

    const appContext = getAppContext();
    const localRepositories = $derived(
        appContext.application.repositoryListItems.filter(
            (repository) => repository.isLocal,
        ),
    );
    const availableGitHubRepositories = $derived(
        appContext.application.githubRepositoriesState,
    );
    const configuredRepositoriesRoot = $derived(
        page.data.systemState?.config?.repositoriesRoot?.trim() ||
            "/repositories",
    );
    const visibleGitHubRepositories = $derived.by(() => {
        const query = repositorySearchQuery.trim().toLowerCase();
        if (!query) {
            return availableGitHubRepositories;
        }

        return availableGitHubRepositories.filter((repository) =>
            [
                repository.repositoryRef,
                repository.description,
                repository.ownerLogin,
                repository.defaultBranch,
                ...(repository.topics ?? []),
            ].some((value) => value?.toLowerCase().includes(query)),
        );
    });

    let addRepositoryOpen = $state(false);
    let repositorySearchQuery = $state("");
    let cloningRepositoryRef = $state<string | undefined>();

    function branchLabel(repositoryKey: string): string {
        const repository =
            appContext.application.resolveRepository(repositoryKey);
        return (
            repository?.syncStatus?.branchRef ??
            repository?.data.currentBranch ??
            "No branch reported"
        );
    }

    function resolveLocalRepositoryHref(
        repositoryRef: string,
    ): string | undefined {
        const existingRepository = localRepositories.find(
            (repository) =>
                repository.platformRepositoryRef?.toLowerCase() ===
                repositoryRef.toLowerCase(),
        );

        if (!existingRepository) {
            return undefined;
        }

        return `/airport/${encodeURIComponent(existingRepository.key)}`;
    }

    function publishCloneNotification(input: {
        title: string;
        message: string;
        tone: "success" | "warning" | "error";
        linkHref?: string;
        linkLabel?: string;
    }): void {
        appContext.application.publishNotification(input);

        const options = input.linkHref
            ? {
                  action: {
                      label: input.linkLabel ?? "Open",
                      onClick: () => {
                          void goto(input.linkHref!);
                      },
                  },
              }
            : undefined;

        if (input.tone === "success") {
            toast.success(input.message, options);
            return;
        }

        if (input.tone === "warning") {
            toast.warning(input.message, options);
            return;
        }

        toast.error(input.message, options);
    }

    function normalizeCommandErrorMessage(error: unknown): string {
        const fallback = error instanceof Error ? error.message : String(error);

        try {
            const parsed = JSON.parse(fallback) as { message?: unknown };
            if (typeof parsed.message === "string" && parsed.message.trim()) {
                return parsed.message.trim();
            }
        } catch {
            return fallback;
        }

        return fallback;
    }

    $effect(() => {
        if (!addRepositoryOpen) {
            return;
        }

        if (availableGitHubRepositories.length > 0) {
            return;
        }

        void appContext.application.loadGitHubRepositories({ force: true });
    });

    async function cloneRepository(repositoryRef: string): Promise<void> {
        cloningRepositoryRef = repositoryRef;

        try {
            const data = RepositoryDataSchema.parse(
                await RepositoryEntity.executeClassCommand("repository.add", {
                    platform: "github",
                    repositoryRef,
                    destinationPath: configuredRepositoriesRoot,
                }),
            );
            const addedRepository =
                appContext.application.hydrateRepositoryData(data);
            await appContext.application.loadRepositories({ force: true });
            publishCloneNotification({
                title: "Repository cloned",
                message: `${repositoryRef} was added to the Airport workspace.`,
                tone: "success",
                linkHref: `/airport/${encodeURIComponent(addedRepository.id)}`,
                linkLabel: "Open repository",
            });
            addRepositoryOpen = false;
            repositorySearchQuery = "";
            await goto(`/airport/${encodeURIComponent(addedRepository.id)}`);
        } catch (error) {
            const message = normalizeCommandErrorMessage(error);
            const existingRepositoryHref =
                resolveLocalRepositoryHref(repositoryRef);
            const isAlreadyCheckedOut = /already checked out/i.test(message);

            publishCloneNotification({
                title: isAlreadyCheckedOut
                    ? "Repository already available"
                    : "Repository clone failed",
                message,
                tone: isAlreadyCheckedOut ? "warning" : "error",
                linkHref: existingRepositoryHref,
                linkLabel: isAlreadyCheckedOut ? "Open repository" : undefined,
            });
        } finally {
            cloningRepositoryRef = undefined;
        }
    }
</script>

<div class="flex min-h-0 flex-1 overflow-auto px-5 py-6 md:px-8 lg:px-12">
    <Dialog.Root bind:open={addRepositoryOpen}>
        <section class="mx-auto flex min-h-full w-full max-w-6xl flex-col">
            <div class="flex min-h-0 flex-1 items-start">
                <div
                    class="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
                >
                    <Dialog.Trigger>
                        {#snippet child({ props })}
                            <button
                                type="button"
                                class="group flex min-h-44 flex-col overflow-hidden rounded-lg border border-primary/40 bg-primary/50 p-5 text-left shadow-sm outline-none transition-[border-color,box-shadow,transform,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/60 hover:shadow-md focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                aria-label="Add repository"
                                {...props}
                            >
                                <div
                                    class="flex items-start justify-between gap-4"
                                >
                                    <span
                                        class="inline-flex size-12 shrink-0 items-center justify-center rounded-md border bg-background text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                                    >
                                        <Icon
                                            icon="lucide:plus"
                                            class="size-6"
                                        />
                                    </span>
                                    <span
                                        class="rounded-md border bg-background px-2 py-1 text-xs font-medium text-muted-foreground"
                                    >
                                        GitHub
                                    </span>
                                </div>

                                <div class="mt-8 flex min-w-0 flex-1 flex-col">
                                    <div class="min-h-14">
                                        <h2
                                            class="line-clamp-2 text-xl font-semibold leading-7 tracking-normal text-foreground"
                                        >
                                            Add Repository
                                        </h2>
                                    </div>
                                    <div class="mt-2 min-h-5">
                                        <p
                                            class="truncate text-sm text-muted-foreground"
                                        >
                                            Clone from GitHub into Airport
                                        </p>
                                    </div>
                                    <div class="mt-4 min-h-12">
                                        <p
                                            class="line-clamp-2 text-sm leading-6 text-muted-foreground"
                                        >
                                            Search available GitHub repositories
                                            and add a new local working copy to
                                            this Airport workspace.
                                        </p>
                                    </div>

                                    <div
                                        class="mt-4 min-h-10 overflow-hidden border-t pt-3 text-xs text-muted-foreground"
                                    >
                                        <p class="truncate">
                                            Destination: {configuredRepositoriesRoot}
                                        </p>
                                    </div>
                                </div>
                            </button>
                        {/snippet}
                    </Dialog.Trigger>

                    {#each localRepositories as repository (repository.key)}
                        <a
                            href={`/airport/${encodeURIComponent(repository.key)}`}
                            class="group flex min-h-44 flex-col overflow-hidden rounded-lg border bg-card p-5 shadow-sm outline-none transition-[border-color,box-shadow,transform,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-muted/20 hover:shadow-md focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                            aria-label={`Open local repository ${repository.displayName}`}
                        >
                            <div class="flex items-start justify-between gap-4">
                                <span
                                    class="inline-flex size-12 shrink-0 items-center justify-center rounded-md border bg-background text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                                >
                                    <Icon
                                        icon={getRepositoryIconIdentifier(
                                            repository.local,
                                        )}
                                        class="size-6"
                                    />
                                </span>
                                <span
                                    class="rounded-md border bg-background px-2 py-1 text-xs font-medium text-muted-foreground"
                                >
                                    {repository.missions.length}
                                    {repository.missions.length === 1
                                        ? "Mission"
                                        : "Missions"}
                                </span>
                            </div>

                            <div class="mt-8 flex min-w-0 flex-1 flex-col">
                                <div class="min-h-14">
                                    <h2
                                        class="line-clamp-2 text-xl font-semibold leading-7 tracking-normal text-foreground"
                                    >
                                        {repository.displayName}
                                    </h2>
                                </div>
                                <div class="mt-2 min-h-5">
                                    <p
                                        class="truncate text-sm text-muted-foreground"
                                    >
                                        {branchLabel(repository.key)}
                                    </p>
                                </div>
                                <div
                                    class="mt-4 min-h-10 overflow-hidden border-t pt-3 text-xs text-muted-foreground"
                                >
                                    {#if repository.repositoryRootPath}
                                        <p class="truncate">
                                            {repository.repositoryRootPath}
                                        </p>
                                    {/if}
                                </div>
                            </div>
                        </a>
                    {/each}

                    {#if localRepositories.length === 0}
                        <div
                            class="grid min-h-44 place-items-center gap-4 rounded-lg border border-dashed bg-card/70 px-8 py-12 text-center shadow-sm"
                        >
                            <span
                                class="inline-flex size-14 items-center justify-center rounded-md border bg-background text-muted-foreground"
                            >
                                <Icon
                                    icon="lucide:folder-search"
                                    class="size-7"
                                />
                            </span>
                            <p class="text-sm leading-6 text-muted-foreground">
                                No local repositories are available yet.
                            </p>
                        </div>
                    {/if}
                </div>
            </div>
        </section>

        <Dialog.Content
            class="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col gap-0 overflow-hidden rounded-none p-0 md:h-auto md:max-h-[80dvh] md:w-[80dvw] md:max-w-[80dvw] md:rounded-4xl"
        >
            <Dialog.Header class="border-b px-6 py-5 text-left">
                <Dialog.Title class="text-xl font-semibold"
                    >Add Repository</Dialog.Title
                >
                <Dialog.Description class="mt-2 text-sm leading-6"
                    >Search available GitHub repositories, then select one to
                    clone it into the local Airport workspace.</Dialog.Description
                >
            </Dialog.Header>

            <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
                <div class="grid gap-4 border-b pb-5">
                    <div class="grid gap-2">
                        <label
                            class="text-sm font-medium text-foreground"
                            for="airport-repository-search"
                        >
                            Search GitHub repositories
                        </label>
                        <div class="relative">
                            <Icon
                                icon="lucide:search"
                                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                id="airport-repository-search"
                                bind:value={repositorySearchQuery}
                                placeholder="Search by owner, repository, topic, or description"
                                class="h-11 pl-10"
                            />
                        </div>
                    </div>
                </div>

                <div class="min-h-0 flex-1 overflow-auto py-5">
                    {#if appContext.application.githubRepositoriesLoading && availableGitHubRepositories.length === 0}
                        <div
                            class="grid place-items-center py-16 text-sm text-muted-foreground"
                        >
                            Loading GitHub repositories...
                        </div>
                    {:else if visibleGitHubRepositories.length === 0}
                        <div class="grid place-items-center py-16 text-center">
                            <span
                                class="inline-flex size-14 items-center justify-center rounded-full border bg-background text-muted-foreground"
                            >
                                <Icon icon="lucide:search-x" class="size-6" />
                            </span>
                            <p class="mt-4 text-sm text-muted-foreground">
                                No GitHub repositories match this search.
                            </p>
                        </div>
                    {:else}
                        <div
                            class="grid w-full grid-cols-1 gap-4 md:grid-cols-2"
                        >
                            {#each visibleGitHubRepositories as repository (repository.repositoryRef)}
                                <button
                                    type="button"
                                    class="group flex min-h-44 flex-col overflow-hidden rounded-lg border bg-card p-5 text-left shadow-sm outline-none transition-[border-color,box-shadow,transform,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-muted/20 hover:shadow-md focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-wait disabled:opacity-60"
                                    disabled={Boolean(cloningRepositoryRef)}
                                    onclick={() =>
                                        cloneRepository(
                                            repository.repositoryRef,
                                        )}
                                >
                                    <div
                                        class="flex items-start justify-between gap-4"
                                    >
                                        <span
                                            class="inline-flex size-12 shrink-0 items-center justify-center rounded-md border bg-background text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                                        >
                                            <Icon
                                                icon="lucide:github"
                                                class="size-6"
                                            />
                                        </span>
                                        <div
                                            class="flex items-center gap-2 text-xs text-muted-foreground"
                                        >
                                            {#if cloningRepositoryRef === repository.repositoryRef}
                                                <span
                                                    class="inline-flex items-center gap-2 rounded-md border bg-background px-2 py-1"
                                                >
                                                    <Icon
                                                        icon="lucide:loader-circle"
                                                        class="size-4 animate-spin"
                                                    />
                                                    <span>Cloning</span>
                                                </span>
                                            {:else}
                                                <span
                                                    class="rounded-md border bg-background px-2 py-1 text-xs font-medium text-muted-foreground"
                                                >
                                                    {repository.visibility}
                                                </span>
                                            {/if}
                                        </div>
                                    </div>

                                    <div
                                        class="mt-8 flex min-w-0 flex-1 flex-col"
                                    >
                                        <div class="min-h-14">
                                            <h2
                                                class="line-clamp-2 text-xl font-semibold leading-7 tracking-normal text-foreground"
                                            >
                                                {repository.repositoryRef}
                                            </h2>
                                        </div>
                                        <div class="mt-2 min-h-5">
                                            <p
                                                class="truncate text-sm text-muted-foreground"
                                            >
                                                {repository.ownerLogin ??
                                                    "GitHub"}
                                            </p>
                                        </div>
                                        <div class="mt-4 min-h-12">
                                            <p
                                                class="line-clamp-2 text-sm leading-6 text-muted-foreground"
                                            >
                                                {repository.description?.trim() ||
                                                    "No description available."}
                                            </p>
                                        </div>

                                        <div
                                            class="mt-4 min-h-10 overflow-hidden border-t pt-3 text-xs text-muted-foreground"
                                        >
                                            <div
                                                class="flex flex-wrap items-center gap-2"
                                            >
                                                {#if repository.defaultBranch}
                                                    <span
                                                        class="rounded-md border bg-background px-2 py-1"
                                                    >
                                                        {repository.defaultBranch}
                                                    </span>
                                                {/if}
                                                {#each repository.topics.slice(0, 3) as topic (`${repository.repositoryRef}:${topic}`)}
                                                    <span
                                                        class="rounded-md border bg-background px-2 py-1"
                                                    >
                                                        {topic}
                                                    </span>
                                                {/each}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        </Dialog.Content>
    </Dialog.Root>
</div>
