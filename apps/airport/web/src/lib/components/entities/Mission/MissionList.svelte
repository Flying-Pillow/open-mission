<script lang="ts">
    import Icon from "@iconify/svelte";
    import { app } from "$lib/client/Application.svelte.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

    const missions = $derived(app.repository?.missions ?? []);
    const repositoryId = $derived(app.repository?.id ?? "");
    const selectedMissionId = $derived(app.mission?.missionId);
</script>

<section class="flex h-full min-h-[20rem] w-full flex-col overflow-hidden">
    <div class="px-1 py-1">
        <h2
            class="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
        >
            Running missions
        </h2>
    </div>

    <ScrollArea class="min-h-0 flex-1">
        <div class="grid gap-3 px-1 pb-2 pt-1">
            {#if missions.length === 0}
                <div
                    class="rounded-none border border-dashed border-border/70 bg-background/35 px-4 py-6 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]"
                >
                    No missions are available in this repository yet.
                </div>
            {:else}
                {#each missions as mission, index (mission.missionId)}
                    <article
                        class={`rounded-none border px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition-transform hover:-translate-y-0.5 ${
                            index % 3 === 0
                                ? "-rotate-[0.8deg] border-black/10 bg-[#fff3a8] text-slate-900 dark:border-[#5b4a1f] dark:bg-[#2b2415] dark:text-slate-100"
                                : index % 3 === 1
                                  ? "rotate-[0.6deg] border-black/10 bg-[#ffd7b8] text-slate-900 dark:border-[#5d3925] dark:bg-[#2d2018] dark:text-slate-100"
                                  : "-rotate-[0.45deg] border-black/10 bg-[#ffe6c9] text-slate-900 dark:border-[#5c4530] dark:bg-[#2b231d] dark:text-slate-100"
                        }`}
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-2">
                                    <h3 class="truncate text-sm font-semibold">
                                        {mission.title}
                                    </h3>
                                    {#if mission.issueId}
                                        <Badge
                                            variant="outline"
                                            class="rounded-none border-black/10 bg-white/45 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
                                        >
                                            #{mission.issueId}
                                        </Badge>
                                    {/if}
                                    {#if mission.missionId === selectedMissionId}
                                        <Badge
                                            variant="secondary"
                                            class="rounded-none bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
                                        >
                                            Open
                                        </Badge>
                                    {/if}
                                </div>
                                <p
                                    class="mt-2 truncate text-xs text-slate-700/80 dark:text-slate-300/80"
                                >
                                    {mission.branchRef}
                                </p>
                                <p
                                    class="mt-1 truncate font-mono text-[11px] text-slate-700/70 dark:text-slate-400/80"
                                >
                                    {mission.missionId}
                                </p>
                            </div>
                            <Button
                                href={`/airport/${encodeURIComponent(repositoryId)}/${encodeURIComponent(mission.missionId)}`}
                                variant="ghost"
                                size="sm"
                                class="shrink-0 rounded-none text-slate-700 hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10"
                            >
                                <Icon
                                    icon="lucide:arrow-up-right"
                                    class="size-4"
                                />
                            </Button>
                        </div>
                    </article>
                {/each}
            {/if}
        </div>
    </ScrollArea>
</section>
