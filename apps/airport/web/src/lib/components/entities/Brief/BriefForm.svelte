<!-- /apps/airport/web/src/lib/components/entities/Brief/BriefForm.svelte: Brief creation form with mission type selector and body input. -->
<script lang="ts">
    import DashboardIcon from "@tabler/icons-svelte/icons/dashboard";
    import DatabaseIcon from "@tabler/icons-svelte/icons/database";
    import FileDescriptionIcon from "@tabler/icons-svelte/icons/file-description";
    import ListDetailsIcon from "@tabler/icons-svelte/icons/list-details";
    import SettingsIcon from "@tabler/icons-svelte/icons/settings";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
    import { startMissionFromBrief } from "../../../../routes/repository/[repositoryId]/mission.remote";

    let briefType = $state<string>("feature");
</script>

<section
    class="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
>
    <h2 class="text-lg font-semibold text-foreground">Start from brief</h2>
    <p class="mt-1 text-sm text-muted-foreground">
        Create a new mission directly from an authored brief when the work is
        not tied to a tracked issue.
    </p>

    <form
        {...startMissionFromBrief}
        class="mt-4 flex min-h-0 flex-1 flex-col gap-3"
    >
        <div class="grid gap-2">
            <label class="text-sm font-medium text-foreground" for="brief-title"
                >Title</label
            >
            <Input
                id="brief-title"
                {...startMissionFromBrief.fields.title.as("text")}
                placeholder="Improve repository mission selection"
            />
            {#each startMissionFromBrief.fields.title.issues() as issue (`title:${issue.message}`)}
                <p class="text-sm text-rose-600">{issue.message}</p>
            {/each}
        </div>

        <div class="grid gap-2">
            <label class="text-sm font-medium text-foreground" for="brief-type"
                >Type</label
            >
            <input
                id="brief-type"
                {...startMissionFromBrief.fields.type.as("hidden", briefType)}
            />
            <ToggleGroup.Root
                type="single"
                bind:value={briefType}
                variant="outline"
                spacing={2}
                class="grid w-full grid-cols-2 gap-2 md:grid-cols-5"
                aria-label="Select brief type"
            >
                <ToggleGroup.Item
                    value="feature"
                    class="justify-start gap-2 data-[state=on]:border-sky-300/70 data-[state=on]:bg-sky-500/10 data-[state=on]:text-sky-700"
                >
                    <DashboardIcon class="size-4 text-sky-500" />
                    Feature
                </ToggleGroup.Item>
                <ToggleGroup.Item
                    value="fix"
                    class="justify-start gap-2 data-[state=on]:border-rose-300/70 data-[state=on]:bg-rose-500/10 data-[state=on]:text-rose-700"
                >
                    <SettingsIcon class="size-4 text-rose-500" />
                    Fix
                </ToggleGroup.Item>
                <ToggleGroup.Item
                    value="docs"
                    class="justify-start gap-2 data-[state=on]:border-amber-300/70 data-[state=on]:bg-amber-500/10 data-[state=on]:text-amber-700"
                >
                    <FileDescriptionIcon class="size-4 text-amber-500" />
                    Docs
                </ToggleGroup.Item>
                <ToggleGroup.Item
                    value="refactor"
                    class="justify-start gap-2 data-[state=on]:border-violet-300/70 data-[state=on]:bg-violet-500/10 data-[state=on]:text-violet-700"
                >
                    <DatabaseIcon class="size-4 text-violet-500" />
                    Refactor
                </ToggleGroup.Item>
                <ToggleGroup.Item
                    value="task"
                    class="justify-start gap-2 data-[state=on]:border-emerald-300/70 data-[state=on]:bg-emerald-500/10 data-[state=on]:text-emerald-700"
                >
                    <ListDetailsIcon class="size-4 text-emerald-500" />
                    Task
                </ToggleGroup.Item>
            </ToggleGroup.Root>
            {#each startMissionFromBrief.fields.type.issues() as issue (`type:${issue.message}`)}
                <p class="text-sm text-rose-600">{issue.message}</p>
            {/each}
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-2">
            <label class="text-sm font-medium text-foreground" for="brief-body"
                >Brief</label
            >
            <textarea
                id="brief-body"
                {...startMissionFromBrief.fields.body.as("text")}
                class="min-h-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm resize-none"
                placeholder="Describe the mission intent, scope, and expected outcome."
            ></textarea>
            {#each startMissionFromBrief.fields.body.issues() as issue (`body:${issue.message}`)}
                <p class="text-sm text-rose-600">{issue.message}</p>
            {/each}
        </div>

        {#each startMissionFromBrief.fields.allIssues() as issue (`all:${issue.message}`)}
            <p class="text-sm text-rose-600">{issue.message}</p>
        {/each}

        <Button type="submit" disabled={!!startMissionFromBrief.pending}>
            {startMissionFromBrief.pending
                ? "Creating mission..."
                : "Create mission"}
        </Button>
    </form>
</section>
