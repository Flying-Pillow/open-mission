import type { Component } from "svelte";
import type {
	DocsFrontmatter,
	DocsLegacyFrontmatter,
	DocsManifest,
	DocsNavItem,
	DocsNavNode,
	DocsPage,
	DocsPageSummary,
} from "./types.ts";

const DOCS_MODULE_PATH_PREFIX = "$docs/";
const DEFAULT_SORT_ORDER = Number.MAX_SAFE_INTEGER;

const docsModuleRegistry = {
	...import.meta.glob([
		"../../../../../docs/*.md",
		"../../../../../docs/**/*.md",
	]),
} as DocsModuleRegistry;

let docsManifestPromise: Promise<DocsManifest> | undefined;

export type DocsMarkdownModule = {
	default: Component;
	metadata?: DocsLegacyFrontmatter;
};

export type DocsModuleRegistry = Record<
	string,
	DocsMarkdownModule | (() => Promise<DocsMarkdownModule>)
>;

export async function loadDocsManifest(
	options?: LoadDocsManifestOptions,
): Promise<DocsManifest> {
	if (options?.modules) {
		return createDocsManifest(await loadDocsModules(options.modules));
	}

	if (options?.forceReload || !docsManifestPromise) {
		docsManifestPromise = loadDocsModules(docsModuleRegistry).then(
			createDocsManifest,
		);
	}

	return docsManifestPromise;
}

export async function resolveDocsPage(
	slug: string[],
	options?: LoadDocsManifestOptions,
): Promise<DocsPage> {
	const manifest = await loadDocsManifest(options);
	const slugKey = toSlugKey(normalizeSlug(slug));
	const page = manifest.pages.find(
		(candidate) => toSlugKey(candidate.slug) === slugKey,
	);

	if (!page) {
		const requestedPath = slugKey.length > 0 ? slugKey : "/";
		throw new Error(
			`No docs page source exists for slug "${requestedPath}".`,
		);
	}

	return page;
}

export function createDocsManifest(
	modules: Record<string, DocsMarkdownModule>,
): DocsManifest {
	const discoveredPages = Object.entries(modules).map(([modulePath, module]) =>
		createDocsPage(modulePath, module),
	);
	const pageBySlug = new Map<string, DocsPage>();

	for (const page of discoveredPages) {
		const slugKey = toSlugKey(page.slug);
		const existingPage = pageBySlug.get(slugKey);
		if (existingPage) {
			throw new Error(
				`Duplicate docs slug "${page.href}" for sources "${existingPage.sourcePath}" and "${page.sourcePath}".`,
			);
		}

		pageBySlug.set(slugKey, page);
	}

	const rootPage = pageBySlug.get("");
	if (!rootPage) {
		throw new Error('Docs manifest requires a root source at "docs/index.md".');
	}

	const childrenByParent = new Map<string, DocsPage[]>();

	for (const page of discoveredPages) {
		if (page.slug.length === 0) {
			continue;
		}

		const parentSlug = page.slug.slice(0, -1);
		const parentSlugKey = toSlugKey(parentSlug);
		const parentPage = pageBySlug.get(parentSlugKey);
		if (!parentPage) {
			throw new Error(
				`Docs page "${page.sourcePath}" requires a section source at "${toSourcePath(parentSlug) ?? "index.md"}".`,
			);
		}

		const parentTitle = page.frontmatter.parent?.trim();
		if (
			parentTitle &&
			parentTitle !== parentPage.title &&
			parentTitle !== parentPage.navigationTitle
		) {
			throw new Error(
				`Docs page "${page.sourcePath}" declares parent "${parentTitle}" but resolves under "${parentPage.title}".`,
			);
		}

		page.section = page.slug.length > 1 ? parentPage.title : undefined;

		const siblings = childrenByParent.get(parentSlugKey) ?? [];
		siblings.push(page);
		childrenByParent.set(parentSlugKey, siblings);
	}

	for (const page of discoveredPages) {
		const childPages = childrenByParent.get(toSlugKey(page.slug)) ?? [];
		if (page.frontmatter.hasChildren && childPages.length === 0) {
			throw new Error(
				`Docs page "${page.sourcePath}" is marked has_children but has no nested page sources.`,
			);
		}
	}

	const topLevelPages = [
		rootPage,
		...(childrenByParent.get("") ?? []),
	].sort(compareDocsPages);
	const navigation = topLevelPages.map((page) =>
		createDocsNavNode(page, childrenByParent),
	);
	const pages = flattenDocsNavigation(navigation);

	return {
		rootPage,
		pages,
		navigation,
	};
}

export function serializeDocsPage(page: DocsPage): DocsPageSummary {
	return {
		slug: [...page.slug],
		href: page.href,
		title: page.title,
		navigationTitle: page.navigationTitle,
		description: page.description,
		section: page.section,
		frontmatter: page.frontmatter,
		sourcePath: page.sourcePath,
		sortOrder: page.sortOrder,
	};
}

export function serializeDocsNavigation(
	navigation: DocsNavNode[],
): DocsNavItem[] {
	return navigation.map((node) => ({
		slug: [...node.slug],
		href: node.href,
		title: node.title,
		order: node.order,
		kind: node.kind,
		children: serializeDocsNavigation(node.children),
	}));
}

type LoadDocsManifestOptions = {
	modules?: DocsModuleRegistry;
	forceReload?: boolean;
};

async function loadDocsModules(
	registry: DocsModuleRegistry,
): Promise<Record<string, DocsMarkdownModule>> {
	const modules = await Promise.all(
		Object.entries(registry).map(async ([modulePath, entry]) => [
			modulePath,
			typeof entry === "function" ? await entry() : entry,
		] as const),
	);

	return Object.fromEntries(modules);
}

function createDocsPage(
	modulePath: string,
	module: DocsMarkdownModule,
): DocsPage {
	const sourcePath = getDocsSourcePathFromModulePath(modulePath);
	const slug = getDocsSlugFromSourcePath(sourcePath);
	const frontmatter = normalizeDocsFrontmatter(module.metadata);

	return {
		slug,
		href: toDocsHref(slug),
		title: frontmatter.title ?? humanizeSlug(slug.at(-1) ?? "docs"),
		navigationTitle:
			frontmatter.navTitle ??
			frontmatter.title ??
			humanizeSlug(slug.at(-1) ?? "docs"),
		description: frontmatter.description,
		section: undefined,
		component: module.default,
		frontmatter,
		sourcePath,
		sortOrder: frontmatter.order ?? DEFAULT_SORT_ORDER,
	};
}

function createDocsNavNode(
	page: DocsPage,
	childrenByParent: Map<string, DocsPage[]>,
): DocsNavNode {
	const childNodes =
		page.slug.length === 0
			? []
			: (childrenByParent.get(toSlugKey(page.slug)) ?? [])
				.sort(compareDocsPages)
				.map((childPage) => createDocsNavNode(childPage, childrenByParent));

	return {
		slug: page.slug,
		href: page.href,
		title: page.navigationTitle,
		order: page.sortOrder,
		kind: childNodes.length > 0 ? "section" : "page",
		children: childNodes,
		page,
	};
}

function flattenDocsNavigation(nodes: DocsNavNode[]): DocsPage[] {
	return nodes.flatMap((node) => [node.page, ...flattenDocsNavigation(node.children)]);
}

function normalizeDocsFrontmatter(
	metadata: DocsLegacyFrontmatter | undefined,
): DocsFrontmatter {
	const title = readString(metadata, "title");
	const description = readString(metadata, "description");
	const order =
		readNumber(metadata, "order") ?? readNumber(metadata, "nav_order", "navOrder");
	const navTitle = readString(metadata, "nav_title", "navTitle");
	const parent = readString(metadata, "parent");
	const hasChildren =
		readBoolean(metadata, "has_children", "hasChildren") ?? false;
	const layout = readString(metadata, "layout");

	return {
		title,
		description,
		order,
		navTitle,
		parent,
		hasChildren,
		layout,
		legacy: {
			layout,
			navTitle,
			navOrder:
				readNumber(metadata, "nav_order", "navOrder") ?? undefined,
			parent,
			hasChildren,
		},
	};
}

function getDocsSourcePathFromModulePath(modulePath: string): string {
	const normalizedModulePath = modulePath.replace(/\\/g, "/");
	if (normalizedModulePath.startsWith(DOCS_MODULE_PATH_PREFIX)) {
		return normalizedModulePath.slice(DOCS_MODULE_PATH_PREFIX.length);
	}

	if (normalizedModulePath.startsWith("docs/")) {
		return normalizedModulePath.slice("docs/".length);
	}

	const docsDirectoryIndex = normalizedModulePath.lastIndexOf("/docs/");
	if (docsDirectoryIndex !== -1) {
		return normalizedModulePath.slice(docsDirectoryIndex + "/docs/".length);
	}

	throw new Error(
		`Unexpected docs module path "${modulePath}". Expected it to start with "${DOCS_MODULE_PATH_PREFIX}".`,
	);
}

export function getDocsModulePath(sourcePath: string): string {
	return `${DOCS_MODULE_PATH_PREFIX}${sourcePath}`;
}

export function loadEagerDocsModules(): Record<string, DocsMarkdownModule> {
	return {
		...import.meta.glob([
			"../../../../../docs/*.md",
			"../../../../../docs/**/*.md",
		], {
			eager: true,
		}),
	} as Record<string, DocsMarkdownModule>;
}

export function getDocsModuleBySourcePath(
	docsModules: Record<string, DocsMarkdownModule>,
	sourcePath: string,
): DocsMarkdownModule | undefined {
	const aliasedModule = docsModules[getDocsModulePath(sourcePath)];
	if (aliasedModule) {
		return aliasedModule;
	}

	for (const [modulePath, docsModule] of Object.entries(docsModules)) {
		if (getDocsSourcePathFromModulePath(modulePath) === sourcePath) {
			return docsModule;
		}
	}

	return undefined;
}

function getDocsSlugFromSourcePath(sourcePath: string): string[] {
	const pathname = sourcePath.replace(/\.md$/i, "");
	if (pathname === "index") {
		return [];
	}

	const segments = pathname.split("/");
	if (segments.at(-1) === "index") {
		segments.pop();
	}

	return normalizeSlug(segments);
}

function toDocsHref(slug: string[]): string {
	return slug.length === 0 ? "/docs" : `/docs/${slug.join("/")}`;
}

function toSourcePath(slug: string[]): string | null {
	if (slug.length === 0) {
		return "index.md";
	}

	const nestedPath = `${slug.join("/")}/index.md`;
	return nestedPath;
}

function toSlugKey(slug: string[]): string {
	return slug.join("/");
}

function normalizeSlug(slug: string[]): string[] {
	return slug
		.flatMap((segment) => segment.split("/"))
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function compareDocsPages(left: DocsPage, right: DocsPage): number {
	return (
		left.sortOrder - right.sortOrder ||
		getFilesystemSortName(left.sourcePath).localeCompare(
			getFilesystemSortName(right.sourcePath),
		) ||
		left.sourcePath.localeCompare(right.sourcePath)
	);
}

function getFilesystemSortName(sourcePath: string): string {
	const segments = sourcePath.replace(/\.md$/i, "").split("/");
	const tail = segments.at(-1);
	if (tail === "index") {
		return segments.at(-2) ?? "index";
	}

	return tail ?? sourcePath;
}

function humanizeSlug(segment: string): string {
	return segment
		.split(/[-_]+/g)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function readString(
	metadata: DocsLegacyFrontmatter | undefined,
	...keys: string[]
): string | undefined {
	for (const key of keys) {
		const value = metadata?.[key];
		if (typeof value === "string") {
			const trimmedValue = value.trim();
			if (trimmedValue.length > 0) {
				return trimmedValue;
			}
		}
	}

	return undefined;
}

function readNumber(
	metadata: DocsLegacyFrontmatter | undefined,
	...keys: string[]
): number | undefined {
	for (const key of keys) {
		const value = metadata?.[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}

		if (typeof value === "string" && value.trim().length > 0) {
			const parsedValue = Number(value);
			if (Number.isFinite(parsedValue)) {
				return parsedValue;
			}
		}
	}

	return undefined;
}

function readBoolean(
	metadata: DocsLegacyFrontmatter | undefined,
	...keys: string[]
): boolean | undefined {
	for (const key of keys) {
		const value = metadata?.[key];
		if (typeof value === "boolean") {
			return value;
		}

		if (typeof value === "string") {
			if (value === "true") {
				return true;
			}

			if (value === "false") {
				return false;
			}
		}
	}

	return undefined;
}
