<script lang="ts">
    import Icon from "@iconify/svelte";
    import {
        createFileArtifact,
        type Artifact as ArtifactEntity,
    } from "$lib/components/entities/Artifact/Artifact.svelte.js";
    import { resolveArtifactIcon } from "$lib/components/entities/Artifact/ArtifactPresentation.js";
    import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";
    import { Button } from "$lib/components/ui/button/index.js";
    import { getAppContext } from "$lib/client/context/app-context.svelte";

    type TimelineItem =
        AgentExecutionDataType["projection"]["timelineItems"][number];
    type ArtifactReference = NonNullable<
        TimelineItem["payload"]["artifacts"]
    >[number];

    const appContext = getAppContext();

    let {
        item,
        openArtifactIds = [],
        onSelectArtifact,
    }: {
        item: TimelineItem;
        openArtifactIds?: string[];
        onSelectArtifact: (artifact: ArtifactEntity) => void;
    } = $props();

    const artifactReferences = $derived.by(() => {
        if (item.payload.artifacts && item.payload.artifacts.length > 0) {
            return item.payload.artifacts;
        }

        if (item.payload.artifactId || item.payload.path) {
            return [
                {
                    ...(item.payload.artifactId
                        ? { artifactId: item.payload.artifactId }
                        : {}),
                    ...(item.payload.path ? { path: item.payload.path } : {}),
                } satisfies ArtifactReference,
            ];
        }

        return [] as ArtifactReference[];
    });

    function normalizePath(value: string): string {
        return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    }

    function resolveArtifact(
        reference: ArtifactReference,
    ): ArtifactEntity | undefined {
        const mission = appContext.airport.activeMission;
        if (mission) {
            const artifacts = mission.listArtifacts();
            if (reference.artifactId) {
                const resolvedById = artifacts.find(
                    (artifact) => artifact.id === reference.artifactId,
                );
                if (resolvedById) {
                    return resolvedById;
                }
            }

            const referencePath = reference.path
                ? normalizePath(reference.path)
                : undefined;
            if (referencePath) {
                const resolvedMissionArtifact = artifacts.find((artifact) => {
                    const artifactPaths = [
                        artifact.relativePath,
                        artifact.filePath,
                        artifact.fileName,
                    ]
                        .filter((candidate): candidate is string =>
                            Boolean(candidate),
                        )
                        .map(normalizePath);
                    return artifactPaths.some(
                        (artifactPath) =>
                            artifactPath === referencePath ||
                            artifactPath.endsWith(`/${referencePath}`) ||
                            referencePath.endsWith(`/${artifactPath}`),
                    );
                });
                if (resolvedMissionArtifact) {
                    return resolvedMissionArtifact;
                }

                const missionRootPath = mission.missionWorktreePath;
                if (missionRootPath) {
                    return createFileArtifact({
                        repositoryRootPath:
                            appContext.airport.activeRepositoryRootPath ??
                            missionRootPath,
                        rootPath: missionRootPath,
                        relativePath: referencePath,
                        label: reference.label,
                    });
                }
            }
        }

        const repositoryRootPath =
            appContext.airport.activeRepositoryRootPath?.trim();
        const referencePath = reference.path
            ? normalizePath(reference.path)
            : undefined;
        if (!repositoryRootPath || !referencePath) {
            return undefined;
        }

        return createFileArtifact({
            repositoryRootPath,
            relativePath: referencePath,
            label: reference.label,
        });
    }

    function artifactLabel(reference: ArtifactReference): string {
        if (reference.label) {
            return reference.label;
        }

        if (reference.path) {
            const normalizedPath = normalizePath(reference.path);
            const segments = normalizedPath.split("/");
            return segments.at(-1) ?? normalizedPath;
        }

        return reference.artifactId ?? "Artifact";
    }

    function artifactCaption(reference: ArtifactReference): string | undefined {
        const parts = [reference.activity, reference.path].filter(
            (value): value is string => Boolean(value),
        );
        return parts.length > 0 ? parts.join(" · ") : undefined;
    }

    function artifactIcon(reference: ArtifactReference): string {
        return resolveArtifactIcon(reference.path ?? reference.label);
    }

    function selectArtifact(artifact: ArtifactEntity | undefined): void {
        if (!artifact) {
            return;
        }

        onSelectArtifact(artifact);
    }
</script>

{#if artifactReferences.length > 0}
    <div
        class={`mt-4 gap-2 border-t border-white/10 pt-4 ${artifactReferences.length > 1 ? "grid grid-cols-2" : "flex flex-wrap"}`}
    >
        {#each artifactReferences as reference (`${reference.artifactId ?? ""}:${reference.path ?? ""}:${reference.activity ?? ""}`)}
            {@const artifact = resolveArtifact(reference)}
            {@const isOpen = Boolean(
                artifact && openArtifactIds.includes(artifact.id),
            )}
            <Button
                variant="outline"
                size="sm"
                class={`h-auto max-w-full items-start justify-start px-3 py-2 text-left ${artifactReferences.length > 1 ? "w-full min-w-0" : ""} ${isOpen ? "border-sky-300/30 bg-sky-300/10 text-slate-50" : ""}`}
                disabled={!artifact}
                onclick={() => selectArtifact(artifact)}
            >
                <span class="flex min-w-0 items-start gap-2">
                    <Icon
                        icon={artifactIcon(reference)}
                        class={`mt-0.5 size-3.5 shrink-0 ${isOpen ? "text-sky-200" : "text-slate-400"}`}
                    />
                    <span class="flex min-w-0 flex-col">
                        <span
                            class="truncate text-xs font-medium text-slate-100"
                        >
                            {artifactLabel(reference)}
                        </span>
                        {#if artifactCaption(reference)}
                            <span class="truncate text-[11px] text-slate-400">
                                {artifactCaption(reference)}
                            </span>
                        {/if}
                    </span>
                </span>
            </Button>
        {/each}
    </div>
{/if}
