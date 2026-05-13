<script lang="ts">
    import Anser from "anser";
    import { untrack } from "svelte";
    import { createVirtualizer } from "@tanstack/svelte-virtual";
    import type { AgentExecutionJournalRecordType } from "@flying-pillow/open-mission-core/entities/AgentExecution/AgentExecutionJournalSchema";

    type AnsiSegment = Anser.AnserJsonEntry;

    let {
        records,
    }: {
        records: AgentExecutionJournalRecordType[];
    } = $props();

    let viewport = $state<HTMLElement | null>(null);
    const occurredAtFormatter = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });

    const initialRecordCount = untrack(() => records.length);
    const rowVirtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
        count: initialRecordCount,
        getScrollElement: () => viewport,
        estimateSize: () => 168,
        getItemKey: (index) => records[index]?.recordId ?? index,
        overscan: 8,
    });

    function getVirtualizer() {
        return untrack(() => $rowVirtualizer);
    }

    $effect(() => {
        getVirtualizer().setOptions({
            count: records.length,
            getScrollElement: () => viewport,
            estimateSize: () => 168,
            getItemKey: (index) => records[index]?.recordId ?? index,
            overscan: 8,
        });
    });

    function measureRow(node: HTMLDivElement): {
        update: () => void;
        destroy: () => void;
    } {
        const measure = () => {
            getVirtualizer().measureElement(node);
        };

        const resizeObserver = new ResizeObserver(() => {
            measure();
        });

        measure();
        resizeObserver.observe(node);

        return {
            update: () => {
                measure();
            },
            destroy: () => {
                resizeObserver.disconnect();
            },
        };
    }

    function formatOccurredAt(value: string): string {
        return occurredAtFormatter.format(new Date(value));
    }

    function formatToken(value: unknown): string {
        if (value === undefined || value === null || value === "") {
            return "Unknown";
        }

        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }

        if (Array.isArray(value)) {
            return value
                .map((entry) => formatToken(entry))
                .filter((entry) => entry !== "Unknown")
                .join(" • ");
        }

        if (typeof value !== "string") {
            if (
                typeof value === "object" &&
                value !== null &&
                "type" in value &&
                typeof value.type === "string"
            ) {
                return formatToken(value.type);
            }

            return String(value);
        }

        return value
            .split(/[.-]/u)
            .filter((segment) => segment.length > 0)
            .map((segment) => segment[0].toUpperCase() + segment.slice(1))
            .join(" ");
    }

    function compactParts(parts: Array<string | undefined>): string {
        return parts
            .filter((value): value is string => Boolean(value))
            .join(" • ");
    }

    function formatOptional(value: string | undefined): string {
        return value?.trim() || "-";
    }

    function readMessageText(payload: unknown): string | undefined {
        if (typeof payload === "string") {
            return payload.trim() || undefined;
        }

        if (
            typeof payload === "object" &&
            payload !== null &&
            "text" in payload &&
            typeof payload.text === "string"
        ) {
            return payload.text.trim() || undefined;
        }

        return undefined;
    }

    function signalSummary(
        signal: AgentExecutionJournalRecordType extends infer _T
            ? Extract<
                  AgentExecutionJournalRecordType,
                  { type: "agent-observation" }
              >["signal"]
            : never,
    ): string | undefined {
        switch (signal?.type) {
            case "progress":
            case "status":
            case "ready_for_verification":
            case "completed_claim":
            case "diagnostic":
                return signal.summary;
            case "needs_input":
                return signal.question;
            case "blocked":
            case "failed_claim":
                return signal.reason;
            case "message":
                return signal.text;
            default:
                return undefined;
        }
    }

    function signalDetail(
        signal: AgentExecutionJournalRecordType extends infer _T
            ? Extract<
                  AgentExecutionJournalRecordType,
                  { type: "agent-observation" }
              >["signal"]
            : never,
    ): string | undefined {
        switch (signal?.type) {
            case "progress":
            case "diagnostic":
                return signal.detail;
            default:
                return undefined;
        }
    }

    function recordSummary(record: AgentExecutionJournalRecordType): string {
        switch (record.type) {
            case "journal.header":
                return `Session started for ${record.agentId}`;
            case "turn.accepted":
                return (
                    readMessageText(record.payload) ??
                    `${formatToken(record.source)} ${formatToken(record.messageType)} accepted`
                );
            case "turn.delivery":
                return `${formatToken(record.status)} via ${formatToken(record.transport)}`;
            case "agent-observation":
                return (
                    signalSummary(record.signal) ??
                    signalDetail(record.signal) ??
                    formatToken(record.signal?.type)
                );
            case "runtime-fact":
                return (
                    record.detail ?? record.path ?? formatToken(record.factType)
                );
            case "decision.recorded":
                return record.reason ?? formatToken(record.action);
            case "state.changed": {
                const parts = [
                    record.lifecycle
                        ? `Lifecycle: ${formatToken(record.lifecycle)}`
                        : undefined,
                    record.attention
                        ? `Attention: ${formatToken(record.attention)}`
                        : undefined,
                    record.activity
                        ? `Activity: ${formatToken(record.activity)}`
                        : undefined,
                    record.currentInputRequestId !== undefined
                        ? `Input: ${record.currentInputRequestId ?? "cleared"}`
                        : undefined,
                    record.awaitingResponseToMessageId !== undefined
                        ? `Awaiting: ${record.awaitingResponseToMessageId ?? "cleared"}`
                        : undefined,
                ].filter((value): value is string => Boolean(value));

                return parts.join(" • ") || "Execution state changed";
            }
            case "activity.updated":
                return (
                    record.progress?.summary ??
                    record.progress?.detail ??
                    record.activity ??
                    "Activity updated"
                );
            case "execution-assessment":
                return record.detail ?? formatToken(record.assessmentType);
            case "transport-evidence":
                return record.content ?? formatToken(record.evidenceType);
            case "owner-effect.recorded":
                return formatToken(record.effectType);
            case "checkpoint.recorded":
                return record.detail ?? formatToken(record.checkpointId);
            case "projection.recorded":
                return `${formatToken(record.projection)} projection recorded`;
        }

        return "Unknown";
    }

    function recordDetail(
        record: AgentExecutionJournalRecordType,
    ): string | undefined {
        switch (record.type) {
            case "journal.header":
                return record.workingDirectory;
            case "turn.delivery":
                return record.reason;
            case "agent-observation":
                return record.rawText ?? signalDetail(record.signal);
            case "runtime-fact":
                return record.path;
            case "activity.updated":
                return record.progress?.detail;
            case "transport-evidence":
                return record.content;
            case "checkpoint.recorded":
                return record.detail;
            default:
                return undefined;
        }
    }

    function recordKind(record: AgentExecutionJournalRecordType): string {
        switch (record.type) {
            case "turn.accepted":
                return compactParts([
                    formatToken(record.source),
                    formatToken(record.messageType),
                    record.mutatesContext ? "Mutates context" : undefined,
                ]);
            case "turn.delivery":
                return compactParts([
                    formatToken(record.status),
                    formatToken(record.transport),
                ]);
            case "agent-observation":
                return compactParts([
                    formatToken(record.source),
                    formatToken(record.confidence),
                    record.signal ? formatToken(record.signal.type) : undefined,
                ]);
            case "runtime-fact":
                return compactParts([
                    formatToken(record.factType),
                    record.artifactId,
                    record.path,
                ]);
            case "execution-assessment":
                return compactParts([
                    formatToken(record.assessmentType),
                    record.score !== undefined
                        ? `Score ${record.score}`
                        : undefined,
                ]);
            case "transport-evidence":
                return formatToken(record.evidenceType);
            case "decision.recorded":
                return formatToken(record.action);
            case "state.changed":
                return compactParts([
                    record.lifecycle
                        ? `Lifecycle ${formatToken(record.lifecycle)}`
                        : undefined,
                    record.attention
                        ? `Attention ${formatToken(record.attention)}`
                        : undefined,
                    record.activity
                        ? `Activity ${formatToken(record.activity)}`
                        : undefined,
                ]);
            case "activity.updated":
                return compactParts([
                    record.activity ? formatToken(record.activity) : undefined,
                    record.progress?.units
                        ? `${record.progress.units.completed}/${record.progress.units.total} ${record.progress.units.unit}`
                        : undefined,
                    record.telemetry?.activeToolName,
                ]);
            case "owner-effect.recorded":
                return compactParts([
                    record.ownerEntity,
                    formatToken(record.effectType),
                ]);
            case "checkpoint.recorded":
                return compactParts([
                    formatToken(record.checkpointId),
                    record.detail,
                ]);
            case "projection.recorded":
                return formatToken(record.projection);
            case "journal.header":
                return compactParts([
                    record.kind,
                    record.transportState
                        ? formatToken(record.transportState)
                        : undefined,
                ]);
        }

        return "Unknown";
    }

    function recordAuthority(record: AgentExecutionJournalRecordType): string {
        return compactParts([
            formatToken(record.authority),
            formatToken(record.assertionLevel),
            formatToken(record.replayClass),
            formatToken(record.origin),
        ]);
    }

    function recordContext(record: AgentExecutionJournalRecordType): string {
        const { owner, mission, repository } = record.executionContext;
        return compactParts([
            `${owner.entityType} ${owner.entityId}`,
            mission?.stageId ? `Stage ${mission.stageId}` : undefined,
            mission?.taskId ? `Task ${mission.taskId}` : undefined,
            repository?.branch ? `Branch ${repository.branch}` : undefined,
            repository?.worktreeId
                ? `Worktree ${repository.worktreeId}`
                : undefined,
        ]);
    }

    function recordRuntime(record: AgentExecutionJournalRecordType): string {
        const runtime = record.executionContext.runtime;
        return compactParts([
            runtime.agentAdapter,
            runtime.provider,
            runtime.model,
            runtime.executionMode
                ? formatToken(runtime.executionMode)
                : undefined,
            runtime.reasoningLevel
                ? formatToken(runtime.reasoningLevel)
                : undefined,
            runtime.workflowStage,
            runtime.verifier ? "Verifier" : undefined,
        ]);
    }

    function recordKeys(record: AgentExecutionJournalRecordType): string {
        switch (record.type) {
            case "journal.header":
                return compactParts([record.recordId, record.agentId]);
            case "turn.accepted":
            case "turn.delivery":
                return compactParts([record.recordId, record.messageId]);
            case "agent-observation":
                return compactParts([record.recordId, record.observationId]);
            case "runtime-fact":
                return compactParts([
                    record.recordId,
                    record.factId,
                    record.artifactId,
                ]);
            case "execution-assessment":
                return compactParts([record.recordId, record.assessmentId]);
            case "transport-evidence":
                return compactParts([record.recordId, record.evidenceId]);
            case "decision.recorded":
                return compactParts([
                    record.recordId,
                    record.decisionId,
                    record.observationId,
                    record.messageId,
                ]);
            case "state.changed":
                return compactParts([
                    record.recordId,
                    record.currentInputRequestId ?? undefined,
                    record.awaitingResponseToMessageId ?? undefined,
                ]);
            case "activity.updated":
                return compactParts([
                    record.recordId,
                    record.currentTarget?.kind,
                    record.currentTarget?.label,
                    record.currentTarget?.path,
                ]);
            case "owner-effect.recorded":
                return compactParts([
                    record.recordId,
                    record.effectId,
                    record.workflowEventId,
                    record.entityEventId,
                ]);
            case "checkpoint.recorded":
                return compactParts([record.recordId, record.checkpointId]);
            case "projection.recorded":
                return record.recordId;
        }

        return "";
    }

    function hasRecordKeys(record: AgentExecutionJournalRecordType): boolean {
        return recordKeys(record).trim().length > 0;
    }

    function ansiSegments(value: string): AnsiSegment[] {
        return Anser.ansiToJson(value, {
            use_classes: false,
            remove_empty: true,
        }).filter((segment) => !segment.isEmpty());
    }

    function ansiText(value: string): string {
        const segments = ansiSegments(value);

        if (segments.length > 0) {
            return segments.map((segment) => segment.content).join("");
        }

        return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, "");
    }

    function sanitizedRecordKeys(
        record: AgentExecutionJournalRecordType,
    ): string {
        return ansiText(recordKeys(record));
    }

    function hasSanitizedRecordKeys(
        record: AgentExecutionJournalRecordType,
    ): boolean {
        return sanitizedRecordKeys(record).trim().length > 0;
    }

    function ansiSegmentStyle(segment: AnsiSegment): string | undefined {
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

{#if records.length === 0}
    <div
        class="rounded-lg border border-dashed border-white/15 bg-white/[0.03] px-5 py-8 text-center"
    >
        <h3 class="text-sm font-medium text-slate-200">
            No journal records yet
        </h3>
        <p class="mt-2 text-sm leading-6 text-slate-400">
            Journal rows will stream here as the execution ledger updates.
        </p>
    </div>
{:else}
    <div
        class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1318]/90 shadow-[0_24px_60px_rgba(0,0,0,0.26)]"
    >
        <div
            class="min-w-[88rem] shrink-0 border-b border-white/10 bg-[#141a20] text-[0.68rem] uppercase tracking-[0.16em] text-slate-400"
        >
            <div
                class="grid grid-cols-[5rem_11rem_12rem_14rem_16rem_20rem_minmax(16rem,1fr)]"
            >
                <div class="px-4 py-3 font-medium">Seq</div>
                <div class="px-4 py-3 font-medium">Time</div>
                <div class="px-4 py-3 font-medium">Type</div>
                <div class="px-4 py-3 font-medium">Kind</div>
                <div class="px-4 py-3 font-medium">Authority</div>
                <div class="px-4 py-3 font-medium">Context</div>
                <div class="px-4 py-3 font-medium">Runtime</div>
            </div>
        </div>

        <div bind:this={viewport} class="min-h-0 flex-1 overflow-auto">
            <div
                class="relative min-w-[88rem]"
                style={`height: ${$rowVirtualizer.getTotalSize()}px;`}
            >
                {#each $rowVirtualizer.getVirtualItems() as virtualRow (virtualRow.key)}
                    {@const record = records[virtualRow.index]}
                    {#if record}
                        {@const summarySegments = ansiSegments(
                            recordSummary(record),
                        )}
                        {@const detail = recordDetail(record)}
                        {@const detailSegments = detail
                            ? ansiSegments(detail)
                            : []}
                        <div
                            data-index={virtualRow.index}
                            class="absolute left-0 top-0 w-full"
                            style={`transform: translateY(${virtualRow.start}px);`}
                            use:measureRow
                        >
                            <div
                                class="grid grid-cols-[5rem_11rem_12rem_14rem_16rem_20rem_minmax(16rem,1fr)] border-t border-white/8 text-slate-200"
                            >
                                <div
                                    class="px-4 py-3 font-mono text-xs text-slate-400"
                                >
                                    {record.sequence}
                                </div>
                                <div class="px-4 py-3 text-xs text-slate-300">
                                    <div class="font-medium text-slate-200">
                                        {formatOccurredAt(record.occurredAt)}
                                    </div>
                                    <div
                                        class="mt-1 font-mono text-[0.7rem] text-slate-500"
                                    >
                                        {record.occurredAt}
                                    </div>
                                </div>
                                <div class="px-4 py-3">
                                    <div class="font-medium text-slate-100">
                                        {formatToken(record.type)}
                                    </div>
                                    <div
                                        class="mt-1 text-[0.72rem] uppercase tracking-[0.12em] text-slate-500"
                                    >
                                        {formatToken(record.family)}
                                    </div>
                                </div>
                                <div
                                    class="px-4 py-3 text-sm leading-6 text-slate-300"
                                >
                                    {formatOptional(recordKind(record))}
                                </div>
                                <div
                                    class="px-4 py-3 text-sm leading-6 text-slate-300"
                                >
                                    {formatOptional(recordAuthority(record))}
                                </div>
                                <div
                                    class="px-4 py-3 text-sm leading-6 text-slate-300"
                                >
                                    {formatOptional(recordContext(record))}
                                </div>
                                <div
                                    class="px-4 py-3 text-sm leading-6 text-slate-300"
                                >
                                    {formatOptional(recordRuntime(record))}
                                </div>
                                <div
                                    class="border-t border-white/8 px-4 py-3"
                                    style="grid-column: 1 / -1;"
                                >
                                    <div
                                        class="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-slate-500"
                                    >
                                        Summary
                                    </div>
                                    <div
                                        class="mt-2 whitespace-pre-wrap break-words font-medium leading-6 text-slate-100"
                                    >
                                        {#if summarySegments.length > 0}
                                            {#each summarySegments as segment, index (`${record.recordId}:summary:${index}:${segment.content}`)}<span
                                                    style={ansiSegmentStyle(
                                                        segment,
                                                    )}>{segment.content}</span
                                                >{/each}
                                        {:else}
                                            {recordSummary(record)}
                                        {/if}
                                    </div>
                                    {#if detail}
                                        <div
                                            class="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-400"
                                        >
                                            {#if detailSegments.length > 0}
                                                {#each detailSegments as segment, index (`${record.recordId}:detail:${index}:${segment.content}`)}<span
                                                        style={ansiSegmentStyle(
                                                            segment,
                                                        )}
                                                        >{segment.content}</span
                                                    >{/each}
                                            {:else}
                                                {detail}
                                            {/if}
                                        </div>
                                    {/if}
                                    {#if hasSanitizedRecordKeys(record)}
                                        <div class="mt-3">
                                            <div
                                                class="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-slate-500"
                                            >
                                                Keys
                                            </div>
                                            <div
                                                class="mt-1 break-words font-mono text-[0.72rem] leading-6 text-slate-400"
                                            >
                                                {sanitizedRecordKeys(record)}
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    {/if}
                {/each}
            </div>
        </div>
    </div>
{/if}
