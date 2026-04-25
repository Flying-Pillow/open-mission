<script lang="ts">
    import { page } from "$app/state";
    import { untrack } from "svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { setScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import type { Repository as RepositoryEntity } from "$lib/client/entities/Repository.svelte.js";
    import { getRepositorySnapshotBundle } from "../../../../routes/api/airport/airport.remote";

    const appContext = getAppContext();
    const repositoryId = $derived(page.params.repositoryId?.trim() ?? "");
    const repositoryScopeState = $state<{
        repositoryId?: string;
        repository?: RepositoryEntity;
        loading: boolean;
        error?: string | null;
    }>({
        loading: false,
    });
    setScopedRepositoryContext(repositoryScopeState);

    const repositorySnapshotBundleQuery = $derived(
        repositoryId ? getRepositorySnapshotBundle({ repositoryId }) : null,
    );
    const repositorySnapshotBundle = $derived(repositorySnapshotBundleQuery?.current);
    const repositoryQueryError = $derived.by(() => {
        const error = repositorySnapshotBundleQuery?.error;
        if (!error) {
            return null;
        }

        return error instanceof Error ? error.message : String(error);
    });

    $effect(() => {
        const snapshotBundle = repositorySnapshotBundle;
        const currentRepositoryId = repositoryId;
        const queryLoading = repositorySnapshotBundleQuery?.loading ?? false;
        const queryError = repositoryQueryError;

        repositoryScopeState.repositoryId = currentRepositoryId || undefined;
        repositoryScopeState.loading = queryLoading;

        untrack(() => {
            if (!snapshotBundle) {
                repositoryScopeState.repository = undefined;
                repositoryScopeState.error = queryError;
                appContext.setActiveRepository({
                    repositoryId: currentRepositoryId || undefined,
                });
                appContext.setActiveMission(undefined);
                return;
            }

            try {
                const repository = appContext.application.syncRepositorySnapshotBundle(
                    snapshotBundle,
                );
                repositoryScopeState.repository = repository;
                repositoryScopeState.error = null;
            } catch (error) {
                repositoryScopeState.repository = undefined;
                repositoryScopeState.error = error instanceof Error ? error.message : String(error);
            }
        });
    });
</script>

<slot />
