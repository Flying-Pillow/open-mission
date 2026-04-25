<script lang="ts">
    import ScopedActionbar from "$lib/components/entities/Actionbar/ScopedActionbar.svelte";

    let {
        refreshNonce,
        onActionExecuted,
    }: {
        refreshNonce: number;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<ScopedActionbar
    {refreshNonce}
    scope="mission"
    class="xl:justify-end"
    buttonClass="shadow-sm"
    defaultVariant="outline"
    showEmptyState={true}
    {onActionExecuted}
/>
