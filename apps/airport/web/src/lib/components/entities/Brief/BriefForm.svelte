<!-- /apps/airport/web/src/lib/components/entities/Brief/BriefForm.svelte: Brief creation form with mission type selector and body input. -->
<script lang="ts">
    import { goto } from "$app/navigation";
    import DashboardIcon from "@tabler/icons-svelte/icons/dashboard";
    import DatabaseIcon from "@tabler/icons-svelte/icons/database";
    import FileDescriptionIcon from "@tabler/icons-svelte/icons/file-description";
    import ListDetailsIcon from "@tabler/icons-svelte/icons/list-details";
    import SettingsIcon from "@tabler/icons-svelte/icons/settings";
    import { missionFromBriefInputSchema } from "@flying-pillow/mission-core/airport/runtime";
    import type { inferFlattenedErrors } from "zod";
    import { getScopedRepositoryContext } from "$lib/client/context/scoped-repository-context.svelte.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Input } from "$lib/components/ui/input/index.js";
    import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";

    type BriefInput = {
        title: string;
        body: string;
        type: "feature" | "fix" | "docs" | "refactor" | "task";
    };

    type BriefErrors = inferFlattenedErrors<BriefInput>["fieldErrors"];

    const repositoryScope = getScopedRepositoryContext();

    let title = $state("");
    let briefBody = $state("");
    let briefType = $state<BriefInput["type"]>("feature");
    let submitPending = $state(false);
    let submitError = $state<string | null>(null);
    let fieldErrors = $state<BriefErrors>({});
    const repository = $derived(repositoryScope.repository);

    async function handleSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        submitError = null;
        fieldErrors = {};

        if (!repository) {
            submitError = "Repository context is unavailable until the repository route is loaded.";
            return;
        }

        const parsed = missionFromBriefInputSchema.safeParse({
            title,
            body: briefBody,
            type: briefType,
        });

        if (!parsed.success) {
            fieldErrors = parsed.error.flatten().fieldErrors as BriefErrors;
            return;
        }

        submitPending = true;
        try {
            const result = await repository.startMissionFromBrief(parsed.data);
            await goto(result.redirectTo);
        } catch (error) {
            submitError = error instanceof Error ? error.message : String(error);
        } finally {
            submitPending = false;
        }
    }
</script>

<section
    class="flex min-h-0 flex-1 flex-col rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
>
    <h2 class="text-lg font-semibold text-foreground">Start from brief</h2>
    <p class="mt-1 text-sm text-muted-foreground">
        Create a new mission directly from an authored brief when the work is
        not tied to a tracked issue.
    </p>

    <form class="mt-4 flex min-h-0 flex-1 flex-col gap-3" onsubmit={handleSubmit}>
        <div class="grid gap-2">
            <label class="text-sm font-medium text-foreground" for="brief-title"
                >Title</label
            >
            <Input
                id="brief-title"
                bind:value={title}
                placeholder="Improve repository mission selection"
            />
            {#each fieldErrors.title ?? [] as issue (`title:${issue}`)}
                <p class="text-sm text-rose-600">{issue}</p>
            {/each}
        </div>

        <div class="grid gap-2">
            <label class="text-sm font-medium text-foreground" for="brief-type"
                >Type</label
            >
            <input id="brief-type" name="brief-type" type="hidden" value={briefType} />
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
            {#each fieldErrors.type ?? [] as issue (`type:${issue}`)}
                <p class="text-sm text-rose-600">{issue}</p>
            {/each}
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-2">
            <label class="text-sm font-medium text-foreground" for="brief-body"
                >Brief</label
            >
            <textarea
                id="brief-body"
                bind:value={briefBody}
                class="min-h-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm resize-none"
                placeholder="Describe the mission intent, scope, and expected outcome."
            ></textarea>
            {#each fieldErrors.body ?? [] as issue (`body:${issue}`)}
                <p class="text-sm text-rose-600">{issue}</p>
            {/each}
        </div>

        {#if submitError}
            <p class="text-sm text-rose-600">{submitError}</p>
        {/if}

        <Button type="submit" disabled={submitPending}>
            {submitPending
                ? "Creating mission..."
                : "Create mission"}
        </Button>
    </form>
</section>
