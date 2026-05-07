<script lang="ts">
    import {
        createAirportTerminalRuntime,
        type AirportTerminalRuntime,
    } from "$lib/client/runtime/terminal/GhosttyTerminalRuntime";
    import type { AgentExecutionTerminalRecordingType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";

    let {
        recording,
    }: {
        recording?: AgentExecutionTerminalRecordingType;
    } = $props();

    let container = $state<HTMLDivElement | null>(null);
    let error = $state<string | null>(null);
    let replayRuntime: AirportTerminalRuntime | null = null;

    $effect(() => {
        const nextRecording = recording;
        const target = container;
        if (!target || !nextRecording) {
            disposeReplay();
            return;
        }

        let disposed = false;
        disposeReplay();
        void initializeReplay(target, nextRecording, () => disposed);

        return () => {
            disposed = true;
            disposeReplay();
        };
    });

    async function initializeReplay(
        target: HTMLDivElement,
        nextRecording: AgentExecutionTerminalRecordingType,
        isDisposed: () => boolean,
    ): Promise<void> {
        error = null;
        const header = nextRecording.events[0];
        if (header?.type !== "header") {
            error = "Terminal recording is missing its header.";
            return;
        }

        try {
            const runtime = await createAirportTerminalRuntime({
                target,
                isDisposed,
                autoFit: false,
                cols: header.cols,
                rows: header.rows,
                cursorBlink: false,
                disableStdin: true,
            });
            if (!runtime || isDisposed()) {
                return;
            }

            replayRuntime = runtime;
            for (const event of nextRecording.events) {
                if (isDisposed()) {
                    return;
                }
                if (event.type === "output") {
                    runtime.terminal.write(event.data);
                }
                if (event.type === "resize") {
                    runtime.terminal.resize(event.cols, event.rows);
                }
            }
        } catch (replayError) {
            disposeReplay();
            error =
                replayError instanceof Error
                    ? replayError.message
                    : String(replayError);
        }
    }

    function disposeReplay(): void {
        replayRuntime?.dispose();
        replayRuntime = null;
    }
</script>

<div class="h-full min-h-[24rem] overflow-auto bg-slate-950 p-2">
    {#if !recording}
        <div
            class="flex h-full min-h-[24rem] items-center justify-center px-6 py-8 text-center text-sm text-slate-400"
        >
            No terminal recording captured.
        </div>
    {:else if error}
        <div
            class="flex h-full min-h-[24rem] items-center justify-center px-6 py-8 text-center text-sm text-rose-300"
        >
            {error}
        </div>
    {/if}
    <div
        bind:this={container}
        class="h-full min-h-[24rem] min-w-max"
        class:hidden={!recording || Boolean(error)}
    ></div>
</div>
