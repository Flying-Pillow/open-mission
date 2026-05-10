import { describe, expect, it } from "vitest";
import type { AgentExecutionDataType } from "@flying-pillow/mission-core/entities/AgentExecution/AgentExecutionSchema";
import {
    timelineItemBodyText,
    timelineItemHeadline,
} from "./timelineItemText";

type TimelineItem =
    AgentExecutionDataType["projection"]["timelineItems"][number];

describe("timelineItemText", () => {
    it("prefers progress summary text over generic activity titles", () => {
        const item = createTimelineItem({
            primitive: "activity.progress",
            payload: {
                title: "Progress",
                text: "Inspecting repository state.\nChecking the next local slice.",
            },
        });

        expect(timelineItemHeadline(item, "Assistant")).toBe(
            "Inspecting repository state.",
        );
        expect(timelineItemBodyText(item, "Assistant")).toBe(
            "Checking the next local slice.",
        );
    });

    it("prefers status summary text over phase titles", () => {
        const item = createTimelineItem({
            primitive: "activity.status",
            payload: {
                title: "Idle",
                text: "Ready for the next structured prompt.",
            },
        });

        expect(timelineItemHeadline(item, "Assistant")).toBe(
            "Ready for the next structured prompt.",
        );
        expect(timelineItemBodyText(item, "Assistant")).toBeUndefined();
    });

    it("keeps the explicit title when no narrative text exists", () => {
        const item = createTimelineItem({
            primitive: "activity.status",
            payload: {
                title: "Initializing",
            },
        });

        expect(timelineItemHeadline(item, "Assistant")).toBe("Initializing");
    });

    it("keeps explicit artifact activity titles for progress items", () => {
        const item = createTimelineItem({
            primitive: "activity.progress",
            payload: {
                title: "Reading artifact",
                text: "Inspecting ArtifactViewer.svelte",
                artifacts: [
                    {
                        path: "apps/airport/web/src/lib/components/entities/Artifact/ArtifactViewer.svelte",
                        activity: "read",
                    },
                ],
            },
        });

        expect(timelineItemHeadline(item, "Assistant")).toBe(
            "Reading artifact",
        );
        expect(timelineItemBodyText(item, "Assistant")).toBe(
            "Inspecting ArtifactViewer.svelte",
        );
    });
});

function createTimelineItem(overrides: {
    primitive: TimelineItem["primitive"];
    payload: TimelineItem["payload"];
}): TimelineItem {
    return {
        id: "timeline-item-1",
        occurredAt: "2026-05-09T12:00:00.000Z",
        zone: "activity",
        primitive: overrides.primitive,
        severity: "info",
        behavior: {
            class: "live-activity",
            compactable: true,
        },
        provenance: {
            durable: true,
            sourceRecordIds: ["record-1"],
            confidence: "authoritative",
        },
        payload: overrides.payload,
    } as TimelineItem;
}