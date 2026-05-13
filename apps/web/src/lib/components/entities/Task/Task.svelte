<script lang="ts">
    import { app } from "$lib/client/Application.svelte.js";
    import AgentChat from "$lib/components/entities/AgentExecution/AgentChat.svelte";
    import TaskCommandbar from "$lib/components/entities/Task/TaskCommandbar.svelte";

    let {
        refreshNonce,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        onCommandExecuted: () => Promise<void>;
    } = $props();
</script>

<section
    class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
>
    <header
        class="flex min-h-11 flex-wrap items-center gap-2 border bg-card/70 px-3 py-2 backdrop-blur-sm overflow-hidden"
    >
        <div class="min-w-0 flex-1">
            <h2 class="truncate text-sm font-semibold text-foreground">
                {app.task?.title ?? "No task selected"}
            </h2>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <TaskCommandbar {refreshNonce} {onCommandExecuted} />
        </div>
    </header>

    <section
        class="flex min-h-0 min-w-0 flex-1 overflow-hidden border border-white/10"
    >
        <AgentChat
            {refreshNonce}
            ownerEntity={app.task}
            {onCommandExecuted}
            loadingTitle="Starting task chat"
            loadingPlaceholder="Starting task chat"
        />
    </section>
</section>
