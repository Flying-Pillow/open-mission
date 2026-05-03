<script lang="ts">
    import { getAppContext } from "$lib/client/context/app-context.svelte";
    import RepositoryPanel from "$lib/components/entities/Repository/RepositoryPanel.svelte";
    import type { AirportRepositoryListItem } from "$lib/components/entities/types";

    const appContext = getAppContext();
    const activeRepository = $derived.by(() => {
        const currentRepository = appContext.airport.activeRepository;
        if (!currentRepository) {
            throw new Error(
                "Repository card requires an active repository in the app context.",
            );
        }

        return currentRepository;
    });
    const activeRepositoryPanelItem = $derived.by(
        (): AirportRepositoryListItem => {
            const listedRepository =
                appContext.application.repositoryListItems.find(
                    (repository) => repository.key === activeRepository.id,
                );
            if (listedRepository) {
                return listedRepository;
            }

            const platformRepositoryRef =
                activeRepository.data.platformRepositoryRef ?? undefined;
            return {
                key: activeRepository.id,
                local: {
                    ...activeRepository.data,
                    missions: activeRepository.missions,
                },
                displayName:
                    platformRepositoryRef ?? activeRepository.data.repoName,
                displayDescription:
                    platformRepositoryRef ??
                    activeRepository.data.repositoryRootPath,
                repositoryRootPath: activeRepository.data.repositoryRootPath,
                ...(platformRepositoryRef ? { platformRepositoryRef } : {}),
                missions: activeRepository.missions,
                isLocal: true,
            };
        },
    );

    async function refreshRepositories(): Promise<void> {
        await appContext.application.loadRepositories({ force: true });
    }
</script>

<RepositoryPanel
    repository={activeRepositoryPanelItem}
    localRepository={activeRepository}
    onCommandExecuted={refreshRepositories}
/>
