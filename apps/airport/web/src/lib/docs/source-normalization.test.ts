import path from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteDocsHref } from "./link-rewrite.ts";
import { loadEagerDocsModules } from "./manifest.ts";
import {
	createDocsSourcePreprocessor,
	getDocsSourcePath,
	normalizeDocsSource,
} from "./source-normalization.ts";
import type { DocsMarkdownModule } from "./manifest.ts";

describe("rewriteDocsHref", () => {
	it("rewrites legacy relative_url links onto the docs route", () => {
		expect(
			rewriteDocsHref("/getting-started/installation.html", {
				sourcePath: "index.md",
			}),
		).toBe("/docs/getting-started/installation");
	});

	it("resolves relative markdown links from the current document path", () => {
		expect(
			rewriteDocsHref("./workflow-engine.html", {
				sourcePath: "architecture/index.md",
			}),
		).toBe("/docs/architecture/workflow-engine");

		expect(
			rewriteDocsHref("../core-workflows/mission-lifecycle.md", {
				sourcePath: "getting-started/start-your-first-mission.md",
			}),
		).toBe("/docs/core-workflows/mission-lifecycle");
	});

	it("collapses section index routes to their section root", () => {
		expect(
			rewriteDocsHref("./index.html", {
				sourcePath: "architecture/agent-runtime.md",
			}),
		).toBe("/docs/architecture");
	});
});

describe("normalizeDocsSource", () => {
	it("preserves legacy frontmatter and rewrites internal docs links", () => {
		const normalizedSource = normalizeDocsSource(
			`---\nlayout: default\nnav_title: Overview\nnav_order: 1\n---\n\n<a class="btn" href="{{ '/getting-started/installation.html' | relative_url }}">Start Here</a>\n\nRead [Tower Control](./workflow-control.html).\n`,
			{ sourcePath: "user-manual/index.md" },
		);

		expect(normalizedSource).toContain("layout: default");
		expect(normalizedSource).toContain("nav_title: Overview");
		expect(normalizedSource).toContain('href="/docs/getting-started/installation"');
		expect(normalizedSource).toContain("[Tower Control](/docs/user-manual/workflow-control)");
	});

	it("leaves inline html blocks intact apart from href rewriting", () => {
		const normalizedSource = normalizeDocsSource(
			`<section class="mission-home-hero">\n  <div class="mission-home-actions">\n    <a class="btn" href="{{ '/user-manual/workflow-control.html' | relative_url }}">Read Tower Control</a>\n  </div>\n</section>\n`,
			{ sourcePath: "index.md" },
		);

		expect(normalizedSource).toContain('<section class="mission-home-hero">');
		expect(normalizedSource).toContain('<div class="mission-home-actions">');
		expect(normalizedSource).toContain('href="/docs/user-manual/workflow-control"');
	});

	it("does not introduce support for unrelated liquid or jekyll constructs", () => {
		const source =
			"{{ page.title }}\n{% include docs-note.html %}\n[External](https://example.com/guide.html)\n";

		expect(normalizeDocsSource(source, { sourcePath: "index.md" })).toBe(source);
	});
});

describe("createDocsSourcePreprocessor", () => {
	it("only normalizes markdown files inside the docs root", async () => {
		const docsRootDirectory = "/repo/docs";
		const preprocessor = createDocsSourcePreprocessor({ docsRootDirectory });

		expect(getDocsSourcePath("/repo/docs/index.md", docsRootDirectory)).toBe(
			"index.md",
		);
		expect(
			getDocsSourcePath("/repo/apps/airport/web/src/app.html", docsRootDirectory),
		).toBeNull();

		const transformed = await preprocessor.markup?.({
			content:
				'<a href="{{ \'/getting-started/installation.html\' | relative_url }}">Start Here</a>',
			filename: path.join(docsRootDirectory, "index.md"),
		});
		expect(transformed?.code).toContain(
			'href="/docs/getting-started/installation"',
		);
	});
});

describe("repo docs mdsvex integration", () => {
	it("imports repository-root docs modules through the mdsvex pipeline", async () => {
		const docsModule = (await import("$docs/index.md")) as DocsMarkdownModule;

		expect(docsModule.default).toBeTruthy();
		expect(docsModule.metadata).toMatchObject({
			layout: "default",
			title: "Mission",
			nav_title: "Overview",
			nav_order: 1,
		});
	});

	it("imports the full repository-root docs corpus through the mdsvex pipeline", async () => {
		const loadedModules = Object.entries(loadEagerDocsModules());

		expect(loadedModules.length).toBeGreaterThan(20);

		for (const [, docsModule] of loadedModules) {
			expect(docsModule.default).toBeTruthy();
			expect(docsModule.metadata).toMatchObject({
				layout: "default",
			});
		}

		const gettingStartedModule = loadedModules.find(([docPath]) =>
			docPath.endsWith("getting-started/index.md"),
		)?.[1];
		expect(gettingStartedModule?.metadata).toMatchObject({
			title: "Getting Started",
			has_children: true,
			nav_order: 2,
		});
	});
});
