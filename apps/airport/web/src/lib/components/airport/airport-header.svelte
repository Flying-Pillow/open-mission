<script lang="ts">
    import { Separator } from "$lib/components/ui/separator/index.js";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
</script>

<header
    class="flex-none flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)"
>
    <div class="flex w-full items-center gap-2 px-4 lg:px-6">
        <Sidebar.Trigger class="-ms-1" />
        <Separator
            orientation="vertical"
            class="mx-2 data-[orientation=vertical]:h-4"
        />
        <div class="min-w-0">
            <p
                class="text-muted-foreground text-[0.7rem] font-medium uppercase tracking-[0.25em]"
            >
                Flying-Pillow
            </p>
            <h1 class="truncate text-sm font-semibold sm:text-base">Mission</h1>
        </div>
        <div class="ms-auto hidden text-sm text-muted-foreground md:block">
            Airport dashboard scaffold
        </div>
    </div>
</header>
