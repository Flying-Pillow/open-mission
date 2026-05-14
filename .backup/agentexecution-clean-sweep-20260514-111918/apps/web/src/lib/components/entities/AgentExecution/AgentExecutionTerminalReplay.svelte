<script lang="ts">
    import Anser from "anser";
    import type { AgentExecutionTerminalRecordingType } from "@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionSchema";

    type TerminalReplaySegment = Anser.AnserJsonEntry;

    let {
        recording,
    }: {
        recording?: AgentExecutionTerminalRecordingType;
    } = $props();

    let error = $state<string | null>(null);
    const terminalReplaySegments = $derived.by(() => {
        const nextRecording = recording;
        error = null;

        if (!nextRecording) {
            return [] as TerminalReplaySegment[];
        }

        const header = nextRecording.events[0];
        if (header?.type !== "header") {
            error = "Terminal recording is missing its header.";
            return [] as TerminalReplaySegment[];
        }

        try {
            const output = nextRecording.events
                .filter(
                    (
                        event,
                    ): event is Extract<typeof event, { type: "output" }> =>
                        event.type === "output",
                )
                .map((event) => event.data)
                .join("");

            return Anser.ansiToJson(output, {
                use_classes: false,
                remove_empty: true,
            }).filter((segment) => !segment.isEmpty());
        } catch (replayError) {
            error =
                replayError instanceof Error
                    ? replayError.message
                    : String(replayError);
            return [] as TerminalReplaySegment[];
        }
    });

    const terminalViewportStyle = $derived.by(() => {
        const header = recording?.events[0];
        if (header?.type !== "header") {
            return undefined;
        }

        return `--terminal-cols: ${header.cols}; --terminal-rows: ${header.rows};`;
    });

    const terminalViewportClass =
        "min-h-[24rem] overflow-auto bg-slate-950 p-2 font-mono text-[0.8rem] leading-6 text-slate-100";

    function replayContentClass(cols: number | undefined): string {
        if (!cols || cols <= 0) {
            return "whitespace-pre-wrap break-words";
        }

        return "whitespace-pre-wrap break-all";
    }

    function replayContentStyle(cols: number | undefined): string | undefined {
        if (!cols || cols <= 0) {
            return undefined;
        }

        return `width: ${cols}ch; min-width: 100%;`;
    }

    function segmentStyle(segment: TerminalReplaySegment): string | undefined {
        const styles: string[] = [];

        if (segment.fg) {
            styles.push(`color: rgb(${segment.fg})`);
        }
        if (segment.bg) {
            styles.push(`background-color: rgb(${segment.bg})`);
        }

        for (const decoration of segment.decorations ?? []) {
            switch (decoration) {
                case "bold":
                    styles.push("font-weight: 700");
                    break;
                case "dim":
                    styles.push("opacity: 0.7");
                    break;
                case "italic":
                    styles.push("font-style: italic");
                    break;
                case "underline":
                    styles.push("text-decoration: underline");
                    break;
                case "hidden":
                    styles.push("visibility: hidden");
                    break;
                case "strikethrough":
                    styles.push("text-decoration: line-through");
                    break;
                default:
                    break;
            }
        }

        return styles.length > 0 ? styles.join("; ") : undefined;
    }
</script>

<div class={terminalViewportClass} style={terminalViewportStyle}>
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
    {:else}
        <pre
            class={replayContentClass(
                recording.events[0]?.type === "header"
                    ? recording.events[0].cols
                    : undefined,
            )}
            style={replayContentStyle(
                recording.events[0]?.type === "header"
                    ? recording.events[0].cols
                    : undefined,
            )}><code
                >{#each terminalReplaySegments as segment, index (`${index}:${segment.content}`)}<span
                        style={segmentStyle(segment)}>{segment.content}</span
                    >{/each}</code
            ></pre>
    {/if}
</div>
