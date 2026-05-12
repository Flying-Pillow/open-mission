<script lang="ts">
    import EntityCommandbar from "$lib/components/entities/Entity/EntityCommandbar.svelte";
    import type { CommandableEntity } from "$lib/components/entities/Entity/CommandableEntity";

    let {
        refreshNonce,
        agentExecution,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        agentExecution?: CommandableEntity;
        onCommandExecuted: () => Promise<void>;
    } = $props();

    const activeCommands = $derived(
        agentExecution?.commands.filter((command) => command.available) ?? [],
    );
</script>

{#if activeCommands.length > 0}
    <EntityCommandbar
        {refreshNonce}
        entity={agentExecution}
        defaultVariant="outline"
        buttonClass="border-white/15 bg-white/[0.04] text-slate-100 shadow-none hover:bg-white/[0.08]"
        showEmptyState={false}
        presentation="responsive"
        iconOnly={true}
        menuLabel="Agent commands"
        {onCommandExecuted}
    />
{/if}
