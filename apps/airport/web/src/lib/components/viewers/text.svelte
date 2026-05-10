<script lang="ts">
    let { source }: { source: string } = $props();
</script>

<pre
    class="h-full min-h-[24rem] overflow-auto bg-background/80 p-4 font-mono text-sm leading-6 text-foreground whitespace-pre-wrap">{source}</pre>
