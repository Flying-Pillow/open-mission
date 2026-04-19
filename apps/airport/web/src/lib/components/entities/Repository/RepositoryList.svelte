<script lang="ts">
    import { enhance } from "$app/forms";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
    import type { MissionSummary } from "$lib/components/entities/types";

    let {
        missions,
        missionCountLabel,
        selectedMissionId,
    }: {
        missions: MissionSummary[];
        missionCountLabel: string;
        selectedMissionId?: string;
    } = $props();
</script>

<section class="rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm">
    <div class="flex items-center justify-between gap-4">
        <div>
            <h2 class="text-lg font-semibold text-foreground">
                Repository missions
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">
                Pick an existing mission in this repository or create a new
                mission from the issue list or a fresh brief.
            </p>
        </div>
        <Badge variant="secondary">{missionCountLabel}</Badge>
    </div>

    <ScrollArea class="mt-4 max-h-72 pr-3">
        <div class="grid gap-3">
            {#if missions.length === 0}
                <div
                    class="rounded-xl border border-dashed bg-background/60 px-4 py-8 text-sm text-muted-foreground"
                >
                    No missions are available in this repository yet.
                </div>
            {:else}
                {#each missions as mission (mission.missionId)}
                    <article
                        class="rounded-xl border bg-background/70 px-4 py-4"
                    >
                        <div
                            class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                        >
                            <div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <h3
                                        class="text-sm font-semibold text-foreground"
                                    >
                                        {mission.title}
                                    </h3>
                                    {#if mission.issueId}
                                        <Badge variant="outline"
                                            >Issue #{mission.issueId}</Badge
                                        >
                                    {/if}
                                    {#if mission.missionId === selectedMissionId}
                                        <Badge variant="secondary"
                                            >Selected</Badge
                                        >
                                    {/if}
                                </div>
                                <p
                                    class="mt-1 font-mono text-xs text-muted-foreground"
                                >
                                    {mission.missionId}
                                </p>
                                <p class="mt-1 text-sm text-muted-foreground">
                                    Branch: {mission.branchRef}
                                </p>
                                <p class="mt-1 text-sm text-muted-foreground">
                                    Created: {mission.createdAt}
                                </p>
                            </div>
                            <form
                                method="POST"
                                action="?/selectMission"
                                use:enhance
                            >
                                <input
                                    type="hidden"
                                    name="missionId"
                                    value={mission.missionId}
                                />
                                <Button type="submit" variant="outline"
                                    >Select mission</Button
                                >
                            </form>
                        </div>
                    </article>
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
