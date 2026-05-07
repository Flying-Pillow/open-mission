export type FrontmatterScalar = string | number | boolean;
export type FrontmatterObject = Record<string, FrontmatterScalar>;

export type FrontmatterValue = FrontmatterScalar | Array<FrontmatterScalar | FrontmatterObject> | FrontmatterObject;

export type ParsedFrontmatterDocument = {
	attributes: Record<string, FrontmatterValue>;
	body: string;
};

export function parseFrontmatterDocument(content: string): ParsedFrontmatterDocument {
	const normalized = content.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) {
		return {
			attributes: {},
			body: normalized
		};
	}

	const closingIndex = normalized.indexOf('\n---\n', 4);
	if (closingIndex < 0) {
		return {
			attributes: {},
			body: normalized
		};
	}

	const rawAttributes = normalized.slice(4, closingIndex);
	const body = normalized.slice(closingIndex + 5);
	const attributes: Record<string, FrontmatterValue> = {};

	for (const rawLine of rawAttributes.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		const separatorIndex = line.indexOf(':');
		if (separatorIndex < 0) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		const rawValue = line.slice(separatorIndex + 1).trim();
		if (!key) {
			continue;
		}

		attributes[key] = parseFrontmatterValue(rawValue);
	}

	return {
		attributes,
		body
	};
}

export function renderFrontmatterDocument(
	attributes: Record<string, FrontmatterValue>,
	body: string
): string {
	const lines = ['---'];
	for (const [key, value] of Object.entries(attributes)) {
		lines.push(`${key}: ${renderFrontmatterValue(value)}`);
	}
	lines.push('---', '', body.trimEnd());
	return `${lines.join('\n')}\n`;
}

function parseFrontmatterValue(rawValue: string): FrontmatterValue {
	if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
		return parseFrontmatterArray(rawValue);
	}

	if (rawValue.startsWith('{') && rawValue.endsWith('}')) {
		return parseFrontmatterObject(rawValue);
	}

	if (/^-?\d+$/.test(rawValue)) {
		return Number(rawValue);
	}

	if (/^(true|false)$/i.test(rawValue)) {
		return /^true$/i.test(rawValue);
	}

	if (
		(rawValue.startsWith('"') && rawValue.endsWith('"')) ||
		(rawValue.startsWith("'") && rawValue.endsWith("'"))
	) {
		return rawValue.slice(1, -1);
	}

	return rawValue;
}

function renderFrontmatterValue(value: FrontmatterValue): string {
	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}

	if (typeof value === 'object') {
		return JSON.stringify(value);
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
}

function parseFrontmatterArray(rawValue: string): Array<FrontmatterScalar | FrontmatterObject> {
	const parsed = JSON.parse(rawValue) as unknown;
	if (!Array.isArray(parsed)) {
		return [rawValue];
	}

	const values: Array<FrontmatterScalar | FrontmatterObject> = [];
	for (const entry of parsed) {
		if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
			values.push(entry);
		} else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
			const object = normalizeFrontmatterObject(entry);
			if (Object.keys(object).length > 0) {
				values.push(object);
			}
		}
	}
	return values;
}

function parseFrontmatterObject(rawValue: string): FrontmatterObject {
	const parsed = JSON.parse(rawValue) as unknown;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {};
	}

	return normalizeFrontmatterObject(parsed);
}

function normalizeFrontmatterObject(value: object): FrontmatterObject {
	const values: FrontmatterObject = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
			values[key] = entry;
		}
	}

	return values;
}
