import type { Component } from "svelte";

export type DocsLegacyFrontmatter = {
	title?: string;
	description?: string;
	order?: number;
	nav_title?: string;
	nav_order?: number;
	parent?: string;
	has_children?: boolean;
	layout?: string;
	[key: string]: unknown;
};

export type DocsFrontmatter = {
	title?: string;
	description?: string;
	order?: number;
	navTitle?: string;
	parent?: string;
	hasChildren?: boolean;
	layout?: string;
	legacy: {
		layout?: string;
		navTitle?: string;
		navOrder?: number;
		parent?: string;
		hasChildren?: boolean;
	};
};

export type DocsPage = {
	slug: string[];
	href: string;
	title: string;
	navigationTitle: string;
	description?: string;
	section?: string;
	component: Component;
	frontmatter: DocsFrontmatter;
	sourcePath: string;
	sortOrder: number;
};

export type DocsPageSummary = {
	slug: string[];
	href: string;
	title: string;
	navigationTitle: string;
	description?: string;
	section?: string;
	frontmatter: DocsFrontmatter;
	sourcePath: string;
	sortOrder: number;
};

export type DocsNavNode = {
	slug: string[];
	href: string;
	title: string;
	order: number;
	kind: "page" | "section";
	children: DocsNavNode[];
	page: DocsPage;
};

export type DocsNavItem = {
	slug: string[];
	href: string;
	title: string;
	order: number;
	kind: "page" | "section";
	children: DocsNavItem[];
};

export type DocsManifest = {
	rootPage: DocsPage;
	pages: DocsPage[];
	navigation: DocsNavNode[];
};

export type DocsSiteMeta = {
	title: string;
	description?: string;
	href: string;
};
