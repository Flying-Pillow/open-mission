<script lang="ts">
    import { app } from "$lib/client/Application.svelte.js";
    import RepositoryPanel from "$lib/components/entities/Repository/RepositoryPanel.svelte";
    import type { AirportRepositoryListItem } from "$lib/components/entities/types";

    const repository = $derived.by(() => {
        const currentRepository = app.repository;
        if (!currentRepository) {
            throw new Error("Repository card requires app.repository.");
        }

        return currentRepository;
    });
    const repositoryPanelItem = $derived.by((): AirportRepositoryListItem => {
        const listedRepository = app.repositoryListItems.find(
            (listedRepository) => listedRepository.key === repository.id,
        );
        if (listedRepository) {
            return listedRepository;
        }

        const platformRepositoryRef =
            repository.data.platformRepositoryRef ?? undefined;
        return {
            key: repository.id,
            local: {
                ...repository.data,
                missions: repository.missions,
            },
            displayName: platformRepositoryRef ?? repository.data.repoName,
            displayDescription:
                platformRepositoryRef ?? repository.data.repositoryRootPath,
            repositoryRootPath: repository.data.repositoryRootPath,
            ...(platformRepositoryRef ? { platformRepositoryRef } : {}),
            missions: repository.missions,
            isLocal: true,
        };
    });

    async function refreshRepositories(): Promise<void> {
        await app.loadRepositories({ force: true });
    }
</script>

<RepositoryPanel
    repository={repositoryPanelItem}
    localRepository={repository}
    onCommandExecuted={refreshRepositories}
/>
