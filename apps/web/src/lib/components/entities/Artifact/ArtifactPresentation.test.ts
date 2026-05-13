import { describe, expect, it } from "vitest";
import {
    isArtifactTextEditable,
    resolveShikiLanguage,
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
        expect(resolveShikiLanguage("logs/agent.interaction.jsonl")).toBe(
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
        expect(resolveShikiLanguage("text/jsonl; charset=utf-8")).toBe(
            "json",
        );
    });

    it("treats .svg artifacts as SVG previews while keeping them editable", () => {
        expect(resolveArtifactViewerKind("artifacts/diagram.svg")).toBe(
            "svg",
        );
        expect(isArtifactTextEditable("artifacts/diagram.svg")).toBe(true);
        expect(resolveMonacoLanguage("artifacts/diagram.svg")).toBe("xml");
        expect(resolveShikiLanguage("artifacts/diagram.svg")).toBe("xml");
    });

    it("resolves Svelte artifacts to Svelte syntax highlighting", () => {
        expect(resolveArtifactViewerKind("components/ArtifactViewer.svelte")).toBe(
            "text",
        );
        expect(resolveMonacoLanguage("components/ArtifactViewer.svelte")).toBe(
            "html",
        );
        expect(resolveShikiLanguage("components/ArtifactViewer.svelte")).toBe(
            "svelte",
        );
    });

    it("supports common backend and infra file extensions", () => {
        expect(resolveArtifactViewerKind("src/main.py")).toBe("text");
        expect(isArtifactTextEditable("src/main.py")).toBe(true);
        expect(resolveMonacoLanguage("src/main.py")).toBe("python");
        expect(resolveShikiLanguage("src/main.py")).toBe("python");

        expect(resolveArtifactViewerKind("infra/main.tf")).toBe("text");
        expect(resolveMonacoLanguage("infra/main.tf")).toBe("plaintext");
        expect(resolveShikiLanguage("infra/main.tf")).toBe("terraform");

        expect(resolveArtifactViewerKind("src/app.tsx")).toBe("text");
        expect(resolveMonacoLanguage("src/app.tsx")).toBe("typescript");
        expect(resolveShikiLanguage("src/app.tsx")).toBe("tsx");
    });

    it("supports basename and suffix-driven artifacts", () => {
        expect(resolveArtifactViewerKind("Dockerfile.prod")).toBe("text");
        expect(isArtifactTextEditable("Dockerfile.prod")).toBe(true);
        expect(resolveMonacoLanguage("Dockerfile.prod")).toBe("plaintext");
        expect(resolveShikiLanguage("Dockerfile.prod")).toBe("docker");

        expect(resolveArtifactViewerKind(".env.local")).toBe("text");
        expect(resolveMonacoLanguage(".env.local")).toBe("plaintext");
        expect(resolveShikiLanguage(".env.local")).toBe("dotenv");

        expect(resolveArtifactViewerKind("resources/views/home.blade.php")).toBe(
            "text",
        );
        expect(resolveMonacoLanguage("resources/views/home.blade.php")).toBe(
            "php",
        );
        expect(resolveShikiLanguage("resources/views/home.blade.php")).toBe(
            "blade",
        );
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
        expect(resolveShikiLanguage("artifacts/screenshot.png")).toBeUndefined();
    });
});