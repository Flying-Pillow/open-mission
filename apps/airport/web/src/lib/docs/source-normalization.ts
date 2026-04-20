import path from "node:path";
import type { PreprocessorGroup } from "svelte/compiler";
import { rewriteDocsLinks } from "./link-rewrite.ts";

export type NormalizeDocsSourceOptions = {
	sourcePath: string;
};

export type CreateDocsSourcePreprocessorOptions = {
	docsRootDirectory: string;
};

export function normalizeDocsSource(
	source: string,
	options: NormalizeDocsSourceOptions,
): string {
	return rewriteDocsLinks(source.replace(/\r\n/g, "\n"), options);
}

export function createDocsSourcePreprocessor(
	options: CreateDocsSourcePreprocessorOptions,
): PreprocessorGroup {
	return {
		markup: async ({ content, filename }) => {
			if (!filename) {
				return undefined;
			}

			const sourcePath = getDocsSourcePath(filename, options.docsRootDirectory);
			if (!sourcePath) {
				return undefined;
			}

			return {
				code: normalizeDocsSource(content, { sourcePath }),
			};
		},
	};
}

export function getDocsSourcePath(
	filename: string,
	docsRootDirectory: string,
): string | null {
	if (path.extname(filename).toLowerCase() !== ".md") {
		return null;
	}

	const normalizedFilename = path.resolve(filename);
	const normalizedDocsRoot = path.resolve(docsRootDirectory);
	const relativePath = path.relative(normalizedDocsRoot, normalizedFilename);
	if (
		relativePath.length === 0 ||
		relativePath.startsWith("..") ||
		path.isAbsolute(relativePath)
	) {
		return null;
	}

	return relativePath.replace(/\\/g, "/");
}
