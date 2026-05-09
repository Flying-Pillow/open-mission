<script lang="ts">
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { CommandableEntity } from "$lib/components/entities/Commandbar/CommandableEntity";

    let {
        refreshNonce,
        agentExecution,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        agentExecution?: CommandableEntity;
        onCommandExecuted: () => Promise<void>;
    } = $props();

    const availableCommands = $derived(
        agentExecution?.commands.filter((command) => !command.disabled) ?? [],
    );
</script>

{#if availableCommands.length > 0}
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
