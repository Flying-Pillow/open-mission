<script lang="ts">
    import EntityCommandbar from "$lib/components/entities/Commandbar/EntityCommandbar.svelte";
    import type { CommandableEntity } from "$lib/components/entities/Commandbar/CommandableEntity";

    let {
        refreshNonce,
        session,
        onCommandExecuted,
    }: {
        refreshNonce: number;
        session?: CommandableEntity;
        onCommandExecuted: () => Promise<void>;
    } = $props();

    const availableCommands = $derived(
        session?.commands.filter((command) => !command.disabled) ?? [],
    );
</script>

{#if availableCommands.length > 0}
    <EntityCommandbar
        {refreshNonce}
        entity={session}
        defaultVariant="outline"
        buttonClass="border-white/15 bg-white/[0.04] text-slate-100 shadow-none hover:bg-white/[0.08]"
        showEmptyState={false}
        presentation="responsive"
        iconOnly={true}
        menuLabel="Agent commands"
        {onCommandExecuted}
    />
{/if}
