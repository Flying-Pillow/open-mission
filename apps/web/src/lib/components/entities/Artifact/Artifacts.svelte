<script lang="ts">
    import Artifact from "$lib/components/entities/Artifact/Artifact.svelte";
    import type { Artifact as ArtifactEntity } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import * as Tabs from "$lib/components/ui/tabs/index.js";

    let {
        refreshNonce,
        artifacts = [],
        activeArtifactId,
        onActiveArtifactChange,
        onCloseArtifact,
    }: {
        refreshNonce: number;
        artifacts?: ArtifactEntity[];
        activeArtifactId?: string;
        onActiveArtifactChange?: (artifactId?: string) => void;
        onCloseArtifact: (artifactId: string) => void;
    } = $props();

    let activeTab = $state("");
    let lastSelectedArtifactId = $state<string | undefined>(undefined);

    const artifactTabs = $derived.by(() => {
        const tabs: ArtifactEntity[] = [];
        for (const candidate of artifacts) {
            if (tabs.some((artifactTab) => artifactTab.id === candidate.id)) {
                continue;
            }

            tabs.push(candidate);
        }

        return tabs;
    });

    $effect(() => {
        const selectedArtifactChanged =
            activeArtifactId !== lastSelectedArtifactId;
        if (selectedArtifactChanged) {
            lastSelectedArtifactId = activeArtifactId;
        }

        if (artifactTabs.length === 0) {
            activeTab = "";
            return;
        }

        const selectedArtifactExists = Boolean(
            activeArtifactId &&
                artifactTabs.some(
                    (candidate) => candidate.id === activeArtifactId,
                ),
        );
        if (
            selectedArtifactChanged &&
            activeArtifactId &&
            selectedArtifactExists
        ) {
            activeTab = activeArtifactId;
            return;
        }

        if (selectedArtifactChanged && !activeArtifactId) {
            activeTab = artifactTabs[0].id;
            return;
        }

        if (!artifactTabs.some((candidate) => candidate.id === activeTab)) {
            activeTab = artifactTabs[0].id;
        }
    });

    $effect(() => {
        const normalizedActiveTab = activeTab.trim() || undefined;
        if (normalizedActiveTab === activeArtifactId) {
            return;
        }

        onActiveArtifactChange?.(normalizedActiveTab);
    });
</script>

<section class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if artifactTabs.length > 0}
        <Tabs.Root
            bind:value={activeTab}
            class="min-h-0 flex-1 overflow-hidden gap-0"
        >
            <Tabs.List
                class="w-full justify-start overflow-x-auto overflow-y-hidden pt-2"
                variant="line"
            >
                {#each artifactTabs as artifactTab (artifactTab.id)}
                    <Tabs.Trigger
                        value={artifactTab.id}
                        class="min-w-24 max-w-56 flex-none truncate"
                    >
                        <span class="truncate">{artifactTab.label}</span>
                    </Tabs.Trigger>
                {/each}
            </Tabs.List>

            {#each artifactTabs as artifactTab (artifactTab.id)}
                <Tabs.Content
                    value={artifactTab.id}
                    class="min-h-0 overflow-hidden"
                >
                    <Artifact
                        {refreshNonce}
                        artifact={artifactTab}
                        onCloseRequested={() => onCloseArtifact(artifactTab.id)}
                    />
                </Tabs.Content>
            {/each}
        </Tabs.Root>
    {/if}
</section>
