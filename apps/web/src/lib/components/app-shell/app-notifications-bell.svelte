<script lang="ts">
    import Icon from "@iconify/svelte";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { app } from "$lib/client/Application.svelte.js";

    let notificationsOpen = $state(false);

    const notifications = $derived(app.notifications);
    const unreadCount = $derived(app.unreadNotificationCount);

    function formatTime(value: string): string {
        return new Intl.DateTimeFormat(undefined, {
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(value));
    }

    function toneClasses(tone: string): string {
        if (tone === "error") {
            return "bg-destructive/12 text-destructive";
        }
        if (tone === "warning") {
            return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
        }
        if (tone === "success") {
            return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
        }
        return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
    }

    $effect(() => {
        if (!notificationsOpen) {
            return;
        }

        app.markAllNotificationsRead();
    });
</script>

<DropdownMenu.Root bind:open={notificationsOpen}>
    <DropdownMenu.Trigger>
        {#snippet child({ props })}
            <Button
                type="button"
                variant="ghost"
                size="icon"
                class="text-muted-foreground hover:text-foreground relative rounded-full"
                aria-label="Open recent messages"
                title="Open recent messages"
                {...props}
            >
                <Icon icon="lucide:bell" class="size-4" />
                {#if unreadCount > 0}
                    <span
                        class="bg-primary text-primary-foreground absolute -top-1 -right-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
                    >
                        {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                {/if}
            </Button>
        {/snippet}
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        class="w-96 rounded-2xl p-0"
        align="end"
        sideOffset={8}
    >
        <div
            class="bg-background/95 flex items-center justify-between border-b px-4 py-3 backdrop-blur"
        >
            <div class="flex items-center gap-2">
                <Icon icon="lucide:bell-ring" class="text-primary size-4" />
                <h3 class="text-sm font-semibold">Recent messages</h3>
            </div>
            {#if notifications.length > 0}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="h-7 px-2 text-xs"
                    onclick={() => app.clearNotifications()}
                >
                    Clear
                </Button>
            {/if}
        </div>

        {#if notifications.length === 0}
            <div
                class="text-muted-foreground flex flex-col items-center justify-center gap-2 px-6 py-10 text-center"
            >
                <Icon icon="lucide:inbox" class="size-6" />
                <p class="text-sm">No recent messages</p>
            </div>
        {:else}
            <div class="max-h-96 overflow-y-auto">
                <div class="divide-border divide-y">
                    {#each notifications as notification (notification.id)}
                        <div class="px-4 py-3">
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2">
                                        <span
                                            class={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClasses(notification.tone)}`}
                                        >
                                            {notification.tone}
                                        </span>
                                        <span
                                            class="text-muted-foreground text-[11px]"
                                        >
                                            {formatTime(notification.createdAt)}
                                        </span>
                                    </div>
                                    <p
                                        class="mt-2 truncate text-sm font-semibold text-foreground"
                                    >
                                        {notification.title}
                                    </p>
                                    <p
                                        class="text-muted-foreground mt-1 text-xs leading-5"
                                    >
                                        {notification.message}
                                    </p>
                                    {#if notification.linkHref}
                                        <a
                                            href={notification.linkHref}
                                            class="text-primary mt-2 inline-flex text-xs font-medium hover:underline"
                                            onclick={() =>
                                                app.markNotificationRead(
                                                    notification.id,
                                                )}
                                        >
                                            {notification.linkLabel ?? "Open"}
                                        </a>
                                    {/if}
                                </div>
                                {#if !notification.read}
                                    <span
                                        class="mt-1 inline-flex size-2 rounded-full bg-primary"
                                    ></span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </DropdownMenu.Content>
</DropdownMenu.Root>
