const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/gu;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export type TemplatePrimitive = string | number | boolean;
export type TemplateValue = TemplatePrimitive | TemplateObject;
export type TemplateObject = {
	[key: string]: TemplateValue;
};

export class TemplateRenderError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'TemplateRenderError';
	}
}

export function renderTemplate(templateText: string, context: TemplateObject): string {
	validateTemplateSyntax(templateText);

	return templateText.replace(PLACEHOLDER_PATTERN, (_match, rawPath: string) => {
		const path = rawPath.trim();
		const segments = parsePathSegments(path);
		const value = resolveTemplateValue(context, segments, path);
		return stringifyTemplateValue(value, path);
	});
}

function validateTemplateSyntax(templateText: string): void {
	let cursor = 0;
	for (const match of templateText.matchAll(PLACEHOLDER_PATTERN)) {
		const matchIndex = match.index ?? 0;
		const between = templateText.slice(cursor, matchIndex);
		assertNoDanglingBraces(between);
		cursor = matchIndex + match[0].length;
	}

	assertNoDanglingBraces(templateText.slice(cursor));
}

function assertNoDanglingBraces(segment: string): void {
	if (segment.includes('{{') || segment.includes('}}')) {
		throw new TemplateRenderError('Template contains malformed placeholder syntax.');
	}
}

function parsePathSegments(path: string): string[] {
	if (path.length === 0) {
		throw new TemplateRenderError('Template placeholder path cannot be empty.');
	}

	const segments = path.split('.');
	for (const segment of segments) {
		if (!IDENTIFIER_PATTERN.test(segment)) {
			throw new TemplateRenderError(`Template placeholder '${path}' has an invalid path segment '${segment}'.`);
		}
		if (BLOCKED_PATH_SEGMENTS.has(segment)) {
			throw new TemplateRenderError(`Template placeholder '${path}' contains blocked path segment '${segment}'.`);
		}
	}

	return segments;
}

function resolveTemplateValue(context: TemplateObject, segments: string[], originalPath: string): TemplateValue {
	let current: TemplateValue = context;

	for (const segment of segments) {
		if (!isTemplateObject(current)) {
			throw new TemplateRenderError(`Template placeholder '${originalPath}' does not resolve to a value.`);
		}
		const currentObject: TemplateObject = current;
		if (!Object.hasOwn(currentObject, segment)) {
			throw new TemplateRenderError(`Template placeholder '${originalPath}' is not defined in the render context.`);
		}
		const next: TemplateValue | undefined = currentObject[segment];
		if (next === undefined) {
			throw new TemplateRenderError(`Template placeholder '${originalPath}' resolved to an undefined value.`);
		}
		current = next;
	}

	return current;
}

function stringifyTemplateValue(value: TemplateValue, originalPath: string): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	throw new TemplateRenderError(`Template placeholder '${originalPath}' resolved to a non-primitive value.`);
}

function isTemplateObject(value: TemplateValue): value is TemplateObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
