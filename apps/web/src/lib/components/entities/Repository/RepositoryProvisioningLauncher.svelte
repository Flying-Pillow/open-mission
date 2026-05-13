<script lang="ts">
    import { goto } from "$app/navigation";
    import Icon from "@iconify/svelte";
    import {
        RepositoryProvisioningDialog,
        type RepositoryNotificationTone,
    } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { app } from "$lib/client/Application.svelte.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import { toast } from "svelte-sonner";

    const configuredRepositoriesRoot = $derived(
        app.system?.config.repositoriesRoot ?? "/repositories",
    );
    const provisioningDialog = new RepositoryProvisioningDialog({
        application: app,
        readDestinationPath: () => configuredRepositoriesRoot,
        notify: (notification) => {
            showNotificationToast(notification);
        },
        navigate: async (href) => {
            await goto(href);
        },
    });

    function showNotificationToast(input: {
        message: string;
        tone: RepositoryNotificationTone;
        linkHref?: string;
        linkLabel?: string;
    }): void {
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

        if (input.tone === "info") {
            toast.info(input.message, options);
            return;
        }

        toast.error(input.message, options);
    }
</script>

<Dialog.Root
    open={provisioningDialog.open}
    onOpenChange={(open) => {
        provisioningDialog.handleOpenChange(open);
    }}
>
    <Dialog.Trigger>
        {#snippet child({ props })}
            <button
                type="button"
                class="group flex min-h-44 flex-col overflow-hidden rounded-lg border border-primary/40 bg-primary/50 p-5 text-left shadow-sm outline-none transition-[border-color,box-shadow,transform,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/60 hover:shadow-md focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                aria-label="Add repository"
                {...props}
            >
                <div class="flex items-start justify-between gap-4">
                    <span
                        class="inline-flex size-12 shrink-0 items-center justify-center rounded-md border bg-background text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                    >
                        <Icon icon="lucide:plus" class="size-6" />
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
                        <p class="truncate text-sm text-muted-foreground">
                            Clone from GitHub into Open Mission
                        </p>
                    </div>
                    <div class="mt-4 min-h-12">
                        <p
                            class="line-clamp-2 text-sm leading-6 text-muted-foreground"
                        >
                            Search available GitHub repositories and add a new
                            local working copy to this Open Mission workspace.
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

    <Dialog.Content
        class="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col gap-0 overflow-hidden rounded-none p-0 md:h-auto md:max-h-[80dvh] md:w-[80dvw] md:max-w-4xl"
    >
        <Dialog.Header class="border-b px-6 py-5 text-left">
            <Dialog.Title class="text-xl font-semibold"
                >Add Repository</Dialog.Title
            >
            <Dialog.Description class="mt-2 text-sm leading-6"
                >Clone an existing GitHub repository or create a brand new one,
                then prepare it immediately for Mission.</Dialog.Description
            >
        </Dialog.Header>

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5">
            <div class="grid gap-4 border-b pb-5">
                <div
                    class="inline-flex w-full rounded-3xl border bg-muted/40 p-1 md:w-auto"
                >
                    <button
                        type="button"
                        class:bg-background={provisioningDialog.mode ===
                            "clone"}
                        class:shadow-sm={provisioningDialog.mode === "clone"}
                        class:text-foreground={provisioningDialog.mode ===
                            "clone"}
                        class="inline-flex flex-1 items-center justify-center gap-2 rounded-[1.25rem] px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:flex-none"
                        onclick={() => {
                            provisioningDialog.selectMode("clone");
                        }}
                    >
                        <Icon icon="lucide:github" class="size-4" />
                        <span>Clone from GitHub</span>
                    </button>
                    <button
                        type="button"
                        class:bg-background={provisioningDialog.mode === "new"}
                        class:shadow-sm={provisioningDialog.mode === "new"}
                        class:text-foreground={provisioningDialog.mode ===
                            "new"}
                        class="inline-flex flex-1 items-center justify-center gap-2 rounded-[1.25rem] px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:flex-none"
                        onclick={() => {
                            provisioningDialog.selectMode("new");
                        }}
                    >
                        <Icon icon="lucide:square-plus" class="size-4" />
                        <span>New repository</span>
                    </button>
                </div>

                {#if provisioningDialog.mode === "clone"}
                    <div class="grid gap-2">
                        <label
                            class="text-sm font-medium text-foreground"
                            for="app-repository-search"
                        >
                            Search GitHub repositories
                        </label>
                        <div class="relative">
                            <Icon
                                icon="lucide:search"
                                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                id="app-repository-search"
                                bind:value={
                                    provisioningDialog.repositorySearchQuery
                                }
                                placeholder="Search by owner, repository, topic, or description"
                                class="h-11 pl-10"
                            />
                        </div>
                    </div>
                {:else}
                    <div class="grid gap-4 md:grid-cols-2">
                        <div class="grid gap-2">
                            <label
                                class="text-sm font-medium text-foreground"
                                for="app-new-repository-owner"
                            >
                                Owner
                            </label>
                            {#if provisioningDialog.availableGitHubOwnersLoading}
                                <div
                                    class="flex h-11 items-center rounded-2xl border bg-muted/40 px-4 text-sm text-muted-foreground"
                                >
                                    Loading GitHub owners...
                                </div>
                            {:else if provisioningDialog.availableGitHubOwnersError}
                                <div class="grid gap-2">
                                    <div
                                        class="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                                    >
                                        {provisioningDialog.availableGitHubOwnersError}
                                    </div>
                                    <button
                                        type="button"
                                        class="inline-flex h-10 items-center justify-center rounded-2xl border px-4 text-sm font-medium"
                                        onclick={() => {
                                            void provisioningDialog.retryOwnerLookup();
                                        }}
                                    >
                                        Retry owner lookup
                                    </button>
                                </div>
                            {:else}
                                <select
                                    id="app-new-repository-owner"
                                    bind:value={
                                        provisioningDialog.newRepositoryOwnerLogin
                                    }
                                    class="border-input bg-background ring-offset-background focus-visible:ring-ring/50 flex h-11 w-full rounded-2xl border px-3 text-sm outline-none focus-visible:ring-[3px]"
                                >
                                    {#each provisioningDialog.availableGitHubOwners as owner (owner.login)}
                                        <option value={owner.login}>
                                            {owner.login}
                                            {owner.type === "Organization"
                                                ? " · organization"
                                                : " · personal"}
                                        </option>
                                    {/each}
                                </select>
                            {/if}
                        </div>

                        <div class="grid gap-2">
                            <label
                                class="text-sm font-medium text-foreground"
                                for="app-new-repository-visibility"
                            >
                                Visibility
                            </label>
                            <select
                                id="app-new-repository-visibility"
                                bind:value={
                                    provisioningDialog.newRepositoryVisibility
                                }
                                class="border-input bg-background ring-offset-background focus-visible:ring-ring/50 flex h-11 w-full rounded-2xl border px-3 text-sm outline-none focus-visible:ring-[3px]"
                            >
                                <option value="private">Private</option>
                                <option value="public">Public</option>
                                {#if provisioningDialog.selectedOwner?.type === "Organization"}
                                    <option value="internal">Internal</option>
                                {/if}
                            </select>
                        </div>

                        <div class="grid gap-2 md:col-span-2">
                            <label
                                class="text-sm font-medium text-foreground"
                                for="app-new-repository-name"
                            >
                                Repository name
                            </label>
                            <Input
                                id="app-new-repository-name"
                                bind:value={
                                    provisioningDialog.newRepositoryName
                                }
                                placeholder="connect-four"
                                class="h-11"
                            />
                        </div>

                        <div
                            class="grid gap-3 rounded-3xl border bg-muted/30 px-4 py-4 md:col-span-2"
                        >
                            <div class="flex items-start justify-between gap-4">
                                <div>
                                    <p
                                        class="text-sm font-medium text-foreground"
                                    >
                                        GitHub destination
                                    </p>
                                    <p
                                        class="mt-1 text-sm text-muted-foreground"
                                    >
                                        {provisioningDialog.newRepositoryRef ??
                                            "Select an owner and name the repository."}
                                    </p>
                                </div>
                                {#if provisioningDialog.selectedOwner}
                                    <span
                                        class="rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground"
                                    >
                                        {provisioningDialog.selectedOwner.type}
                                    </span>
                                {/if}
                            </div>

                            <div
                                class="grid gap-1 text-xs text-muted-foreground"
                            >
                                <p>Local root: {configuredRepositoriesRoot}</p>
                                <p>
                                    Mission will create the GitHub repository,
                                    initialize a local Git checkout, push the
                                    initial branch, and prepare repository
                                    control state immediately.
                                </p>
                            </div>

                            <div class="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    class="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:cursor-wait disabled:opacity-60"
                                    disabled={!provisioningDialog.canCreateRepository ||
                                        provisioningDialog.availableGitHubOwnersLoading ||
                                        provisioningDialog.availableGitHubOwners
                                            .length === 0}
                                    onclick={() => {
                                        void provisioningDialog.createRepository();
                                    }}
                                >
                                    {#if provisioningDialog.creatingRepository}
                                        <Icon
                                            icon="lucide:loader-circle"
                                            class="size-4 animate-spin"
                                        />
                                    {:else}
                                        <Icon
                                            icon="lucide:rocket"
                                            class="size-4"
                                        />
                                    {/if}
                                    <span>
                                        {provisioningDialog.creatingRepository
                                            ? "Creating repository"
                                            : "Create and prepare"}
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="min-h-0 flex-1 overflow-auto py-5">
                {#if provisioningDialog.mode === "new"}
                    <div
                        class="grid h-full min-h-0 place-items-center rounded-3xl border border-dashed bg-card/50 px-8 py-12 text-center"
                    >
                        <div class="grid max-w-lg gap-3">
                            <span
                                class="mx-auto inline-flex size-14 items-center justify-center rounded-full border bg-background text-primary"
                            >
                                <Icon
                                    icon="lucide:folder-plus"
                                    class="size-6"
                                />
                            </span>
                            <h3 class="text-base font-semibold text-foreground">
                                Provision a new Mission repository
                            </h3>
                            <p class="text-sm leading-6 text-muted-foreground">
                                Choose the GitHub owner, name the repository,
                                and Open Mission will create the remote, initialize
                                the local checkout, push it, and register it for
                                Mission in one step.
                            </p>
                        </div>
                    </div>
                {:else if app.githubRepositoriesLoading && provisioningDialog.availableGitHubRepositories.length === 0}
                    <div
                        class="grid place-items-center py-16 text-sm text-muted-foreground"
                    >
                        Loading GitHub repositories...
                    </div>
                {:else if provisioningDialog.visibleGitHubRepositories.length === 0}
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
                    <div class="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
                        {#each provisioningDialog.visibleGitHubRepositories as repository (repository.repositoryRef)}
                            <button
                                type="button"
                                class="group flex min-h-44 flex-col overflow-hidden rounded-lg border bg-card p-5 text-left shadow-sm outline-none transition-[border-color,box-shadow,transform,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-muted/20 hover:shadow-md focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-wait disabled:opacity-60"
                                disabled={Boolean(
                                    provisioningDialog.cloningRepositoryRef,
                                )}
                                onclick={() =>
                                    provisioningDialog.cloneRepository(
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
                                        {#if provisioningDialog.cloningRepositoryRef === repository.repositoryRef}
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

                                <div class="mt-8 flex min-w-0 flex-1 flex-col">
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
                                            {repository.ownerLogin ?? "GitHub"}
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
