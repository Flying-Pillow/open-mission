import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";

type TimelineItem =
    AgentExecutionDataType["projection"]["timelineItems"][number];

function normalizeContentText(value: string): string {
    return value.replace(/\r\n/g, "\n").trim();
}

function normalizedSummary(item: TimelineItem): string | undefined {
    const summary = normalizeContentText(item.payload.summary ?? "");
    return summary.length > 0 ? summary : undefined;
}

function normalizedTitle(item: TimelineItem): string | undefined {
    const title = normalizeContentText(item.payload.title ?? "");
    return title.length > 0 ? title : undefined;
}

function prefersNarrativeHeadline(item: TimelineItem): boolean {
    const hasArtifactActivity = Boolean(
        item.payload.artifacts?.some((artifact) => artifact.activity),
    );

    if (hasArtifactActivity) {
        return false;
    }

    return (
        item.primitive === "activity.progress"
        || item.primitive === "activity.status"
    );
}

function displayTitle(item: TimelineItem): string | undefined {
    const title = normalizedTitle(item);
    if (!title) {
        return undefined;
    }

    if (
        prefersNarrativeHeadline(item)
        && (normalizedSummary(item) || normalizedText(item))
    ) {
        return undefined;
    }

    return title;
}

function normalizedText(item: TimelineItem): string | undefined {
    const text = normalizeContentText(item.payload.text ?? "");
    return text.length > 0 ? text : undefined;
}

function normalizedDetail(item: TimelineItem): string | undefined {
    const detail = normalizeContentText(item.payload.detail ?? "");
    return detail.length > 0 ? detail : undefined;
}

function splitLeadText(value: string):
    | { headline: string; body: string }
    | undefined {
    const separatorMatch = /^(.*?)(?:;|:)(\s+.+)$/u.exec(value);
    if (!separatorMatch) {
        return undefined;
    }

    const headline = separatorMatch[1]?.trim();
    const body = separatorMatch[2]?.trim();
    if (!headline || !body) {
        return undefined;
    }

    return { headline, body };
}

function prefersExplicitTitle(item: TimelineItem): boolean {
    return item.behavior.class === "approval";
}

function prefersQuestionHeadline(item: TimelineItem): boolean {
    return item.primitive === "attention.input-request";
}

export function timelineItemHeadline(
    item: TimelineItem,
    fallbackTitle: string,
): string {
    if (prefersQuestionHeadline(item)) {
        const question = normalizedText(item);
        if (question) {
            const splitQuestion = splitLeadText(question);
            if (splitQuestion) {
                return splitQuestion.headline;
            }

            const [headline] = question.split("\n", 1);
            return headline?.trim() || fallbackTitle;
        }
    }

    const title = displayTitle(item);
    if (title) {
        return title;
    }

    const summary = normalizedSummary(item);
    if (summary) {
        return splitLeadText(summary)?.headline ?? summary;
    }

    const text = normalizedText(item);
    if (!text) {
        return fallbackTitle;
    }

    const splitText = splitLeadText(text);
    if (splitText) {
        return splitText.headline;
    }

    const [headline] = text.split("\n", 1);
    return headline?.trim() || fallbackTitle;
}

export function timelineItemBodyText(
    item: TimelineItem,
    fallbackTitle: string,
): string | undefined {
    if (prefersQuestionHeadline(item)) {
        return normalizedDetail(item);
    }

    const title = displayTitle(item);
    const summary = normalizedSummary(item);
    const text = normalizedText(item);

    if (title) {
        if (text && text !== title) {
            return text;
        }

        if (summary && summary !== title) {
            return summary;
        }

        return normalizedDetail(item);
    }

    if (summary) {
        const splitSummary = splitLeadText(summary);
        if (splitSummary) {
            return splitSummary.body;
        }
    }

    if (text) {
        const splitText = splitLeadText(text);
        if (splitText) {
            return splitText.body;
        }

        const headline = timelineItemHeadline(item, fallbackTitle);
        const newlineIndex = text.indexOf("\n");

        if (newlineIndex !== -1) {
            const firstLine = text.slice(0, newlineIndex).trim();
            if (headline === firstLine) {
                const remainder = text.slice(newlineIndex + 1).trim();
                if (remainder.length > 0) {
                    return remainder;
                }
            }
        }

        if (text !== headline) {
            return text;
        }

        if (newlineIndex !== -1) {
            const remainder = text.slice(newlineIndex + 1).trim();
            if (remainder.length > 0) {
                return remainder;
            }
        }
    }

    return normalizedDetail(item);
}

export function timelineItemAuxDetailText(
    item: TimelineItem,
    fallbackTitle: string,
): string | undefined {
    const detail = normalizedDetail(item);
    if (!detail) {
        return undefined;
    }

    return timelineItemBodyText(item, fallbackTitle) === detail ? undefined : detail;
}