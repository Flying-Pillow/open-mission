<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { TreeViewRootProps } from "./types.js";

    let {
        ref = $bindable(null),
        children,
        class: className,
        ...restProps
    }: TreeViewRootProps = $props();
</script>

<div
    bind:this={ref}
    class={cn("flex flex-1 flex-col", className)}
    {...restProps}
>
    {@render children?.()}
</div>
