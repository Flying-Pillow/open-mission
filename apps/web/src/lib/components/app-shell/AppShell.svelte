<script lang="ts">
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import { getRepositoryIconIdentifier } from "$lib/components/entities/Repository/Repository.svelte.js";
    import RepositoryProvisioningLauncher from "$lib/components/entities/Repository/RepositoryProvisioningLauncher.svelte";

    const localRepositories = $derived(
        app.repositoryListItems.filter((repository) => repository.isLocal),
    );

    function branchLabel(repositoryKey: string): string {
        const repository = app.resolveRepository(repositoryKey);
        return (
            repository?.syncStatus?.branchRef ??
            repository?.data.currentBranch ??
            "No branch reported"
        );
    }
</script>

<div class="flex min-h-0 flex-1 overflow-auto px-5 py-6 md:px-8 lg:px-12">
    <section class="mx-auto flex min-h-full w-full max-w-6xl flex-col">
        <div class="flex min-h-0 flex-1 items-start">
            <div
                class="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
            >
                <RepositoryProvisioningLauncher />

                {#each localRepositories as repository (repository.key)}
                    <a
                        href={`/app/${encodeURIComponent(repository.key)}`}
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
                            <Icon icon="lucide:folder-search" class="size-7" />
                        </span>
                        <p class="text-sm leading-6 text-muted-foreground">
                            No local repositories are available yet.
                        </p>
                    </div>
                {/if}
            </div>
        </div>
    </section>
</div>
