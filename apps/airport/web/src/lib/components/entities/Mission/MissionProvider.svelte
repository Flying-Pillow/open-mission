<script lang="ts">
    import { page } from "$app/state";
    import { untrack } from "svelte";
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import { setScopedMissionContext } from "$lib/client/context/scoped-mission-context.svelte.js";
    import type { Mission as MissionEntity } from "$lib/client/entities/Mission.svelte.js";
    import type { Repository as RepositoryEntity } from "$lib/client/entities/Repository.svelte.js";
    import { getMissionSnapshotBundle } from "../../../../routes/api/airport/airport.remote";

    const appContext = getAppContext();
    const repositoryId = $derived(page.params.repositoryId?.trim() ?? "");
    const missionId = $derived(page.params.missionId?.trim() ?? "");
    const missionScopeState = $state<{
        repositoryId?: string;
        missionId?: string;
        mission?: MissionEntity;
        repository?: RepositoryEntity;
        loading: boolean;
        error?: string | null;
    }>({
        loading: false,
    });
    setScopedMissionContext(missionScopeState);

    const missionSnapshotBundleQuery = $derived(
        repositoryId && missionId
            ? getMissionSnapshotBundle({ repositoryId, missionId })
            : null,
    );
    const missionSnapshotBundle = $derived(missionSnapshotBundleQuery?.current);
    const missionQueryError = $derived.by(() => {
        const error = missionSnapshotBundleQuery?.error;
        if (!error) {
            return null;
        }

        return error instanceof Error ? error.message : String(error);
    });

    $effect(() => {
        const snapshotBundle = missionSnapshotBundle;
        const currentRepositoryId = repositoryId;
        const currentMissionId = missionId;
        const queryLoading = missionSnapshotBundleQuery?.loading ?? false;
        const queryError = missionQueryError;

        missionScopeState.repositoryId = currentRepositoryId || undefined;
        missionScopeState.missionId = currentMissionId || undefined;
        missionScopeState.loading = queryLoading;

        untrack(() => {
            if (!snapshotBundle) {
                missionScopeState.repository = undefined;
                missionScopeState.mission = undefined;
                missionScopeState.error = queryError;
                appContext.setActiveRepository({
                    repositoryId: currentRepositoryId || undefined,
                });
                appContext.setActiveMission(currentMissionId || undefined);
                return;
            }

            try {
                const mission = appContext.application.syncMissionSnapshotBundle(
                    snapshotBundle,
                );
                const repository = appContext.application.hydrateRepositoryData(
                    snapshotBundle.repositorySnapshot,
                );
                missionScopeState.repository = repository;
                missionScopeState.mission = mission;
                missionScopeState.error = null;
            } catch (error) {
                missionScopeState.repository = undefined;
                missionScopeState.mission = undefined;
                missionScopeState.error = error instanceof Error ? error.message : String(error);
            }
        });
    });
</script>

<slot />
