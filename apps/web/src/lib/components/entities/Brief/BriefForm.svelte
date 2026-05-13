<!-- /apps/web/src/lib/components/entities/Brief/BriefForm.svelte: Brief creation form with title and body input. -->
<script lang="ts">
    import { goto } from "$app/navigation";
    import { MissionFromBriefInputSchema } from "@flying-pillow/open-mission-core/entities/Repository/RepositorySchema";
    import type { inferFlattenedErrors } from "zod/v4";
    import { app } from "$lib/client/Application.svelte.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Input } from "$lib/components/ui/input/index.js";

    type BriefErrors = inferFlattenedErrors<
        typeof MissionFromBriefInputSchema
    >["fieldErrors"];

    let {
        embedded = false,
    }: {
        embedded?: boolean;
    } = $props();

    let title = $state("");
    let briefBody = $state("");
    let submitPending = $state(false);
    let submitError = $state<string | null>(null);
    let fieldErrors = $state<BriefErrors>({});
    const canStartMission = $derived(
        Boolean(app.repository?.data.isInitialized),
    );

    async function handleSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        submitError = null;
        fieldErrors = {};

        if (!app.repository) {
            submitError = "Repository is unavailable.";
            return;
        }

        if (!canStartMission) {
            submitError =
                "Complete Repository initialization before starting regular missions.";
            return;
        }

        const parsed = MissionFromBriefInputSchema.safeParse({
            title,
            body: briefBody,
        });

        if (!parsed.success) {
            fieldErrors = parsed.error.flatten().fieldErrors as BriefErrors;
            return;
        }

        submitPending = true;
        try {
            const result = await app.repository.startMissionFromBrief(
                parsed.data,
            );
            await goto(result.redirectTo);
        } catch (error) {
            submitError =
                error instanceof Error ? error.message : String(error);
        } finally {
            submitPending = false;
        }
    }
</script>

<section
    class={embedded
        ? "flex min-h-0 flex-1 flex-col"
        : "flex min-h-0 flex-1 flex-col rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"}
>
    {#if !embedded}
        <h2 class="text-lg font-semibold text-foreground">Start from brief</h2>
        <p class="mt-1 text-sm text-muted-foreground">
            Create a new mission directly from an authored brief when the work
            is not tied to a tracked issue.
        </p>
    {/if}

    <form
        class={`${embedded ? "" : "mt-4 "}flex min-h-0 flex-1 flex-col gap-3`}
        onsubmit={handleSubmit}
    >
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

        <Button type="submit" disabled={submitPending || !canStartMission}>
            {submitPending
                ? "Creating mission..."
                : canStartMission
                  ? "Create mission"
                  : "Initialization required"}
        </Button>
    </form>
</section>
