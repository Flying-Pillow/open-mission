import { describe, expect, it } from "vitest";
import {
    isArtifactTextEditable,
    resolveArtifactViewerKind,
    resolveMonacoLanguage,
} from "./ArtifactPresentation";

describe("ArtifactPresentation", () => {
    it("treats .jsonl artifacts as editable text with JSON syntax", () => {
        expect(resolveArtifactViewerKind("logs/agent.interaction.jsonl")).toBe(
            "text",
        );
        expect(isArtifactTextEditable("logs/agent.interaction.jsonl")).toBe(
            true,
        );
        expect(resolveMonacoLanguage("logs/agent.interaction.jsonl")).toBe(
            "json",
        );
    });

    it("treats text/jsonl media types as editable text with JSON syntax", () => {
        expect(resolveArtifactViewerKind("text/jsonl")).toBe("text");
        expect(isArtifactTextEditable("text/jsonl")).toBe(true);
        expect(resolveMonacoLanguage("text/jsonl")).toBe("json");
        expect(resolveMonacoLanguage("text/jsonl; charset=utf-8")).toBe(
            "json",
        );
    });

    it("treats .svg artifacts as SVG previews while keeping them editable", () => {
        expect(resolveArtifactViewerKind("artifacts/diagram.svg")).toBe(
            "svg",
        );
        expect(isArtifactTextEditable("artifacts/diagram.svg")).toBe(true);
        expect(resolveMonacoLanguage("artifacts/diagram.svg")).toBe("xml");
    });

    it("treats binary image artifacts as image previews and not text editors", () => {
        expect(resolveArtifactViewerKind("artifacts/screenshot.png")).toBe(
            "image",
        );
        expect(resolveArtifactViewerKind("artifacts/photo.jpg")).toBe(
            "image",
        );
        expect(resolveArtifactViewerKind("artifacts/animation.gif")).toBe(
            "image",
        );
        expect(isArtifactTextEditable("artifacts/screenshot.png")).toBe(
            false,
        );
        expect(resolveMonacoLanguage("artifacts/screenshot.png")).toBe(
            "plaintext",
        );
    });
});