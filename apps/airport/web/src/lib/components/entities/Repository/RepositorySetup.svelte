<script lang="ts">
    import Icon from "@iconify/svelte";
    import {
        RepositorySettingsSchema,
        type RepositorySetupResultType,
    } from "@flying-pillow/mission-core/entities/Repository/RepositorySchema";
    import type { inferFlattenedErrors } from "zod/v4";
    import type { Repository } from "$lib/components/entities/Repository/Repository.svelte.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Input } from "$lib/components/ui/input/index.js";

    type SettingsErrors = inferFlattenedErrors<
        typeof RepositorySettingsSchema
    >["fieldErrors"];

    let {
        repository,
        onSetupSubmitted,
    }: {
        repository: Repository;
        onSetupSubmitted: () => Promise<void>;
    } = $props();

    let initializedRepositoryId = $state("");
    let missionsRoot = $state("");
    let instructionsPath = $state("");
    let skillsPath = $state("");
    let agentAdapter = $state("copilot-cli");
    let defaultAgentMode = $state("");
    let defaultModel = $state("");
    let defaultReasoningEffort = $state("");
    let submitPending = $state(false);
    let submitError = $state<string | null>(null);
    let setupResult = $state<RepositorySetupResultType | null>(null);
    let fieldErrors = $state<SettingsErrors>({});

    $effect(() => {
        if (initializedRepositoryId === repository.id) {
            return;
        }
        const settings = repository.data.settings;
        missionsRoot = settings.missionsRoot;
        instructionsPath = settings.instructionsPath;
        skillsPath = settings.skillsPath;
        agentAdapter = settings.agentAdapter;
        defaultAgentMode = settings.defaultAgentMode ?? "";
        defaultModel = settings.defaultModel ?? "";
        defaultReasoningEffort = settings.defaultReasoningEffort ?? "";
        initializedRepositoryId = repository.id;
    });

    async function handleSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        submitError = null;
        setupResult = null;
        fieldErrors = {};

        const parsed = RepositorySettingsSchema.safeParse({
            missionsRoot,
            trackingProvider: "github",
            instructionsPath,
            skillsPath,
            agentAdapter,
            agentAdapters: repository.data.settings.agentAdapters,
            ...(defaultAgentMode ? { defaultAgentMode } : {}),
            ...(defaultModel.trim()
                ? { defaultModel: defaultModel.trim() }
                : {}),
            ...(defaultReasoningEffort.trim()
                ? { defaultReasoningEffort: defaultReasoningEffort.trim() }
                : {}),
        });

        if (!parsed.success) {
            fieldErrors = parsed.error.flatten().fieldErrors as SettingsErrors;
            return;
        }

        submitPending = true;
        try {
            setupResult = await repository.setup(parsed.data);
            await onSetupSubmitted();
        } catch (error) {
            submitError =
                error instanceof Error ? error.message : String(error);
        } finally {
            submitPending = false;
        }
    }
</script>

<section
    class="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background"
>
    <div class="border-b bg-muted/20 px-5 py-4">
        <div
            class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
        >
            <div class="min-w-0">
                <div class="flex items-center gap-2 text-muted-foreground">
                    <Icon icon="lucide:settings" class="size-4" />
                    <p class="text-xs font-medium uppercase tracking-[0.14em]">
                        Repository setup
                    </p>
                </div>
                <h2 class="mt-2 text-lg font-semibold text-foreground">
                    {repository.data.platformRepositoryRef ??
                        repository.data.repoName}
                </h2>
            </div>
            <div
                class="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
            >
                .mission/settings.json
            </div>
        </div>
    </div>

    <form class="grid gap-5 px-5 py-5" onsubmit={handleSubmit}>
        <div class="grid gap-4 md:grid-cols-2">
            <div class="grid gap-2">
                <label
                    class="text-sm font-medium text-foreground"
                    for="repository-setup-missions-root"
                >
                    Missions root
                </label>
                <Input
                    id="repository-setup-missions-root"
                    bind:value={missionsRoot}
                />
                {#each fieldErrors.missionsRoot ?? [] as issue (`missionsRoot:${issue}`)}
                    <p class="text-sm text-rose-600">{issue}</p>
                {/each}
            </div>

            <div class="grid gap-2">
                <label
                    class="text-sm font-medium text-foreground"
                    for="repository-setup-agent-adapter"
                >
                    Agent adapter
                </label>
                <select
                    id="repository-setup-agent-adapter"
                    bind:value={agentAdapter}
                    class="h-10 rounded-md border bg-background px-3 text-sm text-foreground"
                >
                    <option value="copilot-cli">Copilot CLI</option>
                    <option value="claude-code">Claude Code</option>
                    <option value="pi">Pi</option>
                    <option value="codex">Codex</option>
                    <option value="opencode">OpenCode</option>
                </select>
                {#each fieldErrors.agentAdapter ?? [] as issue (`agentAdapter:${issue}`)}
                    <p class="text-sm text-rose-600">{issue}</p>
                {/each}
            </div>

            <div class="grid gap-2">
                <label
                    class="text-sm font-medium text-foreground"
                    for="repository-setup-instructions-path"
                >
                    Instructions path
                </label>
                <Input
                    id="repository-setup-instructions-path"
                    bind:value={instructionsPath}
                />
                {#each fieldErrors.instructionsPath ?? [] as issue (`instructionsPath:${issue}`)}
                    <p class="text-sm text-rose-600">{issue}</p>
                {/each}
            </div>

            <div class="grid gap-2">
                <label
                    class="text-sm font-medium text-foreground"
                    for="repository-setup-skills-path"
                >
                    Skills path
                </label>
                <Input
                    id="repository-setup-skills-path"
                    bind:value={skillsPath}
                />
                {#each fieldErrors.skillsPath ?? [] as issue (`skillsPath:${issue}`)}
                    <p class="text-sm text-rose-600">{issue}</p>
                {/each}
            </div>

            <div class="grid gap-2">
                <label
                    class="text-sm font-medium text-foreground"
                    for="repository-setup-agent-mode"
                >
                    Default agent mode
                </label>
                <select
                    id="repository-setup-agent-mode"
                    bind:value={defaultAgentMode}
                    class="h-10 rounded-md border bg-background px-3 text-sm text-foreground"
                >
                    <option value="">Adapter default</option>
                    <option value="interactive">Interactive</option>
                    <option value="autonomous">Autonomous</option>
                </select>
                {#each fieldErrors.defaultAgentMode ?? [] as issue (`defaultAgentMode:${issue}`)}
                    <p class="text-sm text-rose-600">{issue}</p>
                {/each}
            </div>

            <div class="grid gap-2">
                <label
                    class="text-sm font-medium text-foreground"
                    for="repository-setup-default-model"
                >
                    Default model
                </label>
                <Input
                    id="repository-setup-default-model"
                    bind:value={defaultModel}
                    placeholder="Adapter default"
                />
                {#each fieldErrors.defaultModel ?? [] as issue (`defaultModel:${issue}`)}
                    <p class="text-sm text-rose-600">{issue}</p>
                {/each}
            </div>

            <div class="grid gap-2">
                <label
                    class="text-sm font-medium text-foreground"
                    for="repository-setup-default-reasoning-effort"
                >
                    Default reasoning effort
                </label>
                <select
                    id="repository-setup-default-reasoning-effort"
                    bind:value={defaultReasoningEffort}
                    class="h-10 rounded-md border bg-background px-3 text-sm text-foreground"
                >
                    <option value="">Adapter default</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="xhigh">XHigh</option>
                </select>
                {#each fieldErrors.defaultReasoningEffort ?? [] as issue (`defaultReasoningEffort:${issue}`)}
                    <p class="text-sm text-rose-600">{issue}</p>
                {/each}
            </div>
        </div>

        {#if submitError}
            <p class="text-sm text-rose-600">{submitError}</p>
        {/if}

        {#if setupResult}
            <div
                class="rounded-md border bg-muted/20 px-4 py-3 text-sm text-foreground"
            >
                <div
                    class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                >
                    <p>
                        Setup PR created for {setupResult.baseBranch}.
                        {#if setupResult.merged}
                            Merged{setupResult.basePulled
                                ? " and pulled locally"
                                : ""}.
                        {:else if setupResult.autoMergeSucceeded}
                            Auto-merge requested.
                        {:else}
                            Auto-merge needs attention.
                        {/if}
                    </p>
                    <Button
                        href={setupResult.pullRequestUrl}
                        target="_blank"
                        rel="noreferrer"
                        variant="outline"
                        size="sm"
                    >
                        <Icon icon="lucide:git-pull-request" class="size-4" />
                        Open PR
                    </Button>
                </div>
                {#if setupResult.autoMergeError}
                    <p class="mt-2 text-sm text-amber-700 dark:text-amber-300">
                        {setupResult.autoMergeError}
                    </p>
                {/if}
                {#if setupResult.basePullError}
                    <p class="mt-2 text-sm text-amber-700 dark:text-amber-300">
                        {setupResult.basePullError}
                    </p>
                {/if}
            </div>
        {/if}

        <div class="flex justify-end">
            <Button type="submit" disabled={submitPending}>
                <Icon icon="lucide:git-pull-request-create" class="size-4" />
                {submitPending ? "Creating setup PR..." : "Create setup PR"}
            </Button>
        </div>
    </form>
</section>
