import type { Component } from "svelte";
import { describe, expect, it } from "vitest";
import {
	createDocsManifest,
	getDocsModuleBySourcePath,
	getDocsModulePath,
	resolveDocsPage,
	serializeDocsNavigation,
	serializeDocsPage,
	type DocsMarkdownModule,
} from "./manifest.ts";

const TestComponent = (() => null) as unknown as Component;

describe("docs manifest", () => {
	it("derives stable navigation and page records from the docs corpus", () => {
		const manifest = createDocsManifest(
			import.meta.glob("$docs/**/*.md", {
				eager: true,
			}) as Record<string, DocsMarkdownModule>,
		);

		expect(manifest.rootPage.sourcePath).toBe("index.md");
		expect(manifest.pages.length).toBeGreaterThan(20);
		expect(manifest.pages[0]).toMatchObject({
			sourcePath: "index.md",
			href: "/docs",
			title: "Mission",
			navigationTitle: "Overview",
		});
		expect(manifest.navigation.map((node) => node.title)).toEqual([
			"Overview",
			"Getting Started",
			"Core Workflows",
			"User Manual",
			"Architecture",
			"Reference",
		]);

		const architectureNode = manifest.navigation.find(
			(node) => node.href === "/docs/architecture",
		);
		expect(architectureNode).toMatchObject({
			kind: "section",
			title: "Architecture",
		});
		expect(architectureNode?.children.map((node) => node.title)).toEqual([
			"System Context",
			"Repository And Dossier",
			"Semantic Model",
			"Daemon And System Control Plane",
			"Workflow Engine",
			"Agent Runtime",
			"Airport Control Plane",
			"Airport Terminal Surface",
			"Contracts And State Surfaces",
			"Airport Web Surface Blueprint",
			"Recovery And Reconciliation",
			"Package Map",
			"Integrity Checklist",
			"Discrepancies And Ambiguities",
		]);

		expect(new Set(flattenNavigationHrefs(manifest.navigation))).toEqual(
			new Set(manifest.pages.map((page) => page.href)),
		);
	});

	it("resolves the docs root and nested slugs against the same shared manifest", async () => {
		const modules = import.meta.glob("$docs/**/*.md", {
			eager: true,
		}) as Record<string, DocsMarkdownModule>;

		await expect(resolveDocsPage([], { modules })).resolves.toMatchObject({
			sourcePath: "index.md",
			href: "/docs",
		});
		await expect(
			resolveDocsPage(["getting-started"], { modules }),
		).resolves.toMatchObject({
			sourcePath: "getting-started/index.md",
			href: "/docs/getting-started",
		});
		await expect(
			resolveDocsPage(["getting-started", "installation"], { modules }),
		).resolves.toMatchObject({
			sourcePath: "getting-started/installation.md",
			href: "/docs/getting-started/installation",
			section: "Getting Started",
		});
		await expect(resolveDocsPage(["missing-page"], { modules })).rejects.toThrow(
			'No docs page source exists for slug "missing-page".',
		);
	});

	it("fails explicitly when nested pages do not have a section index source", () => {
		expect(() =>
			createDocsManifest({
				"$docs/index.md": createModule({
					title: "Mission",
					nav_title: "Overview",
				}),
				"$docs/getting-started/installation.md": createModule({
					title: "Installation",
					parent: "Getting Started",
					nav_order: 1,
				}),
			}),
		).toThrow(
			'Docs page "getting-started/installation.md" requires a section source at "getting-started/index.md".',
		);
	});

	it("maps legacy metadata into typed frontmatter and validates stale parent labels", () => {
		expect(() =>
			createDocsManifest({
				"$docs/index.md": createModule({
					title: "Mission",
					nav_title: "Overview",
				}),
				"$docs/reference/index.md": createModule({
					title: "Reference",
					nav_order: 2,
					has_children: true,
				}),
				"$docs/reference/cli-commands.md": createModule({
					title: "CLI Commands",
					parent: "Docs",
					nav_order: 1,
				}),
			}),
		).toThrow(
			'Docs page "reference/cli-commands.md" declares parent "Docs" but resolves under "Reference".',
		);
	});

	it("projects docs manifest records into route-safe navigation and page data", () => {
		const manifest = createDocsManifest(
			import.meta.glob("$docs/**/*.md", {
				eager: true,
			}) as Record<string, DocsMarkdownModule>,
		);

		expect(serializeDocsPage(manifest.rootPage)).toMatchObject({
			href: "/docs",
			title: "Mission",
			sourcePath: "index.md",
		});
		expect(serializeDocsNavigation(manifest.navigation)[0]).toMatchObject({
			href: "/docs",
			title: "Overview",
		});
		expect(getDocsModulePath("reference/index.md")).toBe(
			"$docs/reference/index.md",
		);
	});

	it("resolves docs modules by normalized source path across glob key shapes", () => {
		const rootModule = createModule({
			title: "Mission",
			nav_title: "Overview",
		});
		const nestedModule = createModule({
			title: "Reference",
		});

		expect(
			getDocsModuleBySourcePath(
				{
					"/repo/docs/index.md": rootModule,
					"$docs/reference/index.md": nestedModule,
				},
				"index.md",
			),
		).toBe(rootModule);
		expect(
			getDocsModuleBySourcePath(
				{
					"/repo/docs/index.md": rootModule,
					"$docs/reference/index.md": nestedModule,
				},
				"reference/index.md",
			),
		).toBe(nestedModule);
	});
});

function flattenNavigationHrefs(navigation: ReturnType<typeof createDocsManifest>["navigation"]): string[] {
	return navigation.flatMap((node) => [node.href, ...flattenNavigationHrefs(node.children)]);
}

function createModule(metadata: DocsMarkdownModule["metadata"]): DocsMarkdownModule {
	return {
		default: TestComponent,
		metadata,
	};
}
