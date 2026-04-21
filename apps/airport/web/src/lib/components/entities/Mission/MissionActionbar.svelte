<script lang="ts">
    import ScopedActionbar from "$lib/components/entities/Actionbar/ScopedActionbar.svelte";

    let {
        missionId,
        repositoryId,
        repositoryRootPath,
        refreshNonce,
        onActionExecuted,
    }: {
        missionId: string;
        repositoryId: string;
        repositoryRootPath: string;
        refreshNonce: number;
        onActionExecuted: () => Promise<void>;
    } = $props();
</script>

<ScopedActionbar
    {missionId}
    {repositoryId}
    {repositoryRootPath}
    {refreshNonce}
    scope="mission"
    class="xl:justify-end"
    buttonClass="shadow-sm"
    defaultVariant="outline"
    showEmptyState={true}
    {onActionExecuted}
/>
