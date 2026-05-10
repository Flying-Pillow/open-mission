<script lang="ts">
    import { untrack } from "svelte";
    import Icon from "@iconify/svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import DaemonSystemStatus from "./DaemonSystemStatus.svelte";

    const MAX_VISIBLE_LINES = 300;

    let {
        initiallyEnabled = false,
        embedded = false,
        fill = false,
    }: {
        initiallyEnabled?: boolean;
        embedded?: boolean;
        fill?: boolean;
    } = $props();

    let enabled = $state(untrack(() => initiallyEnabled));
    let connected = $state(false);
    let logPath = $state("");
    let lines = $state<string[]>([]);
    let errorMessage = $state<string | undefined>();
    let viewport = $state<HTMLDivElement | undefined>();

    function trimLines(nextLines: string[]): string[] {
        return nextLines.slice(-MAX_VISIBLE_LINES);
    }

    function appendLines(nextLines: string[]): void {
        lines = trimLines([...lines, ...nextLines]);
    }

    function readLines(event: MessageEvent<string>): string[] {
        const payload = JSON.parse(event.data) as { lines?: unknown };
        return Array.isArray(payload.lines)
            ? payload.lines.filter(
                  (line): line is string => typeof line === "string",
              )
            : [];
    }

    function scrollToBottom(): void {
        queueMicrotask(() => {
            if (!viewport) {
                return;
            }
            viewport.scrollTop = viewport.scrollHeight;
        });
    }

    $effect(() => {
        if (!enabled) {
            connected = false;
            return;
        }

        errorMessage = undefined;
        const source = new EventSource("/api/runtime/daemon/logs?tail=160");

        source.addEventListener("snapshot", (event) => {
            const payload = JSON.parse(
                (event as MessageEvent<string>).data,
            ) as {
                logPath?: unknown;
                lines?: unknown;
            };
            logPath =
                typeof payload.logPath === "string" ? payload.logPath : "";
            lines = trimLines(
                Array.isArray(payload.lines)
                    ? payload.lines.filter(
                          (line): line is string => typeof line === "string",
                      )
                    : [],
            );
            connected = true;
            scrollToBottom();
        });

        source.addEventListener("append", (event) => {
            appendLines(readLines(event as MessageEvent<string>));
            connected = true;
            scrollToBottom();
        });

        source.addEventListener("error", () => {
            connected = false;
            errorMessage = "Log stream reconnecting";
        });

        return () => {
            source.close();
            connected = false;
        };
    });
</script>

<section
    class={fill
        ? "grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden"
        : embedded
          ? "grid min-h-0"
          : "border bg-card shadow-sm"}
>
    <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
            <div class="flex items-center gap-2">
                <Icon
                    icon="lucide:scroll-text"
                    class="size-4 text-muted-foreground"
                />
                <h2 class="text-sm font-semibold text-foreground">
                    Daemon logs
                </h2>
                {#if enabled}
                    <span
                        class={`inline-flex size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`}
                        aria-label={connected
                            ? "Log stream connected"
                            : "Log stream reconnecting"}
                    ></span>
                {/if}
            </div>
            {#if logPath}
                <p class="mt-1 truncate text-xs text-muted-foreground">
                    {logPath}
                </p>
            {/if}
        </div>

        <Button
            variant="outline"
            size="sm"
            onclick={() => (enabled = !enabled)}
        >
            <Icon
                icon={enabled ? "lucide:square" : "lucide:play"}
                class="size-4"
            />
            {enabled ? "Stop tail" : "Tail logs"}
        </Button>
    </div>

    <DaemonSystemStatus {fill} />

    {#if enabled}
        <div
            class={fill
                ? "h-full min-h-0 overflow-hidden border bg-background"
                : "mt-3 overflow-hidden border bg-background"}
        >
            <div
                bind:this={viewport}
                class={fill
                    ? "h-full min-h-0 overflow-auto font-mono text-xs leading-5 text-muted-foreground"
                    : embedded
                      ? "max-h-[min(28rem,calc(100svh-18rem))] min-h-80 overflow-auto font-mono text-xs leading-5 text-muted-foreground"
                      : "max-h-80 overflow-auto font-mono text-xs leading-5 text-muted-foreground"}
            >
                {#if lines.length > 0}
                    {#each lines as line, index (`${index}:${line}`)}
                        <div class="whitespace-pre-wrap break-words">
                            {line}
                        </div>
                    {/each}
                {:else}
                    <div class="text-muted-foreground/75">
                        No daemon log entries yet.
                    </div>
                {/if}
            </div>
        </div>
        {#if errorMessage}
            <p class="mt-2 text-xs text-amber-600">{errorMessage}</p>
        {/if}
    {/if}
</section>
