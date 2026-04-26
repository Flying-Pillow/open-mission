<script lang="ts">
    import EntityActionbar from "$lib/components/entities/Actionbar/EntityActionbar.svelte";
    import type { AgentSession } from "$lib/components/entities/AgentSession/AgentSession.svelte.js";

    let {
        refreshNonce,
        session,
        onActionExecuted,
    }: {
        refreshNonce: number;
        session?: AgentSession;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<EntityActionbar
    {refreshNonce}
    entity={session}
    defaultVariant="outline"
    buttonClass="shadow-sm"
    showEmptyState={false}
    {onActionExecuted}
/>
