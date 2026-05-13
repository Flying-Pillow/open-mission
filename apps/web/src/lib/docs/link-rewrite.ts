import path from "node:path";

const DOCS_ROUTE_PREFIX = "/docs";
const INTERNAL_DOC_EXTENSION_PATTERN = /\.(?:html|md|markdown)$/i;
const EXTERNAL_URL_PATTERN = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const ABSOLUTE_DOCS_PREFIX_PATTERN = /^\/docs(?:\/|$)/i;

export type RewriteDocsLinkOptions = {
	sourcePath: string;
};

export function rewriteDocsLinks(
	source: string,
	options: RewriteDocsLinkOptions,
): string {
	return rewriteHtmlHrefs(
		rewriteMarkdownLinks(rewriteJekyllRelativeUrls(source, options), options),
		options,
	);
}

export function rewriteDocsHref(
	target: string,
	options: RewriteDocsLinkOptions,
): string | null {
	const trimmedTarget = target.trim();
	if (
		trimmedTarget.length === 0 ||
		trimmedTarget.startsWith("#") ||
		EXTERNAL_URL_PATTERN.test(trimmedTarget) ||
		ABSOLUTE_DOCS_PREFIX_PATTERN.test(trimmedTarget)
	) {
		return null;
	}

	const { pathname, suffix } = splitHref(trimmedTarget);
	if (!isInternalDocsPath(pathname)) {
		return null;
	}

	const resolvedPathname = resolveDocsPathname(pathname, options.sourcePath);
	if (resolvedPathname === null) {
		return null;
	}

	const routePath =
		resolvedPathname === "index"
			? ""
			: resolvedPathname.replace(/\/index$/i, "");

	return `${DOCS_ROUTE_PREFIX}${routePath ? `/${routePath}` : ""}${suffix}`;
}

function rewriteJekyllRelativeUrls(
	source: string,
	options: RewriteDocsLinkOptions,
): string {
	return source.replace(
		/\{\{\s*(["'])([^"'{}]+)\1\s*\|\s*relative_url\s*\}\}/g,
		(match, _quote: string, target: string) =>
			rewriteDocsHref(target, options) ?? match,
	);
}

function rewriteMarkdownLinks(
	source: string,
	options: RewriteDocsLinkOptions,
): string {
	return source.replace(
		/(?<!!)\[([^\]]+)\]\(([^)\s]+)(\s+["'][^"']*["'])?\)/g,
		(match, label: string, href: string, title: string | undefined) => {
			const rewrittenHref = rewriteDocsHref(href, options);
			if (!rewrittenHref) {
				return match;
			}

			return `[${label}](${rewrittenHref}${title ?? ""})`;
		},
	);
}

function rewriteHtmlHrefs(
	source: string,
	options: RewriteDocsLinkOptions,
): string {
	return source.replace(
		/\bhref=(["'])([^"']+)\1/g,
		(match, quote: string, href: string) => {
			const rewrittenHref = rewriteDocsHref(href, options);
			if (!rewrittenHref) {
				return match;
			}

			return `href=${quote}${rewrittenHref}${quote}`;
		},
	);
}

function splitHref(href: string): { pathname: string; suffix: string } {
	const hashIndex = href.indexOf("#");
	const queryIndex = href.indexOf("?");
	const splitIndex =
		hashIndex === -1
			? queryIndex
			: queryIndex === -1
				? hashIndex
				: Math.min(hashIndex, queryIndex);

	if (splitIndex === -1) {
		return { pathname: href, suffix: "" };
	}

	return {
		pathname: href.slice(0, splitIndex),
		suffix: href.slice(splitIndex),
	};
}

function isInternalDocsPath(pathname: string): boolean {
	return INTERNAL_DOC_EXTENSION_PATTERN.test(pathname);
}

function resolveDocsPathname(
	pathname: string,
	sourcePath: string,
): string | null {
	const sourceDirectory = path.posix.dirname(normalizePath(sourcePath));
	const resolvedPath = pathname.startsWith("/")
		? normalizePath(pathname).slice(1)
		: path.posix.normalize(path.posix.join(sourceDirectory, normalizePath(pathname)));

	if (
		resolvedPath.length === 0 ||
		resolvedPath === "." ||
		resolvedPath.startsWith("../")
	) {
		return null;
	}

	return resolvedPath.replace(INTERNAL_DOC_EXTENSION_PATTERN, "");
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/");
}
