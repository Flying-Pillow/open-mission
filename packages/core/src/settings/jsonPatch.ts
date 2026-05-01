import type { WorkflowDefinition } from '../workflow/engine/types.js';
import { WorkflowSettingsError, type JsonPatchOperation } from './types.js';

const ALLOWED_PATH_PREFIXES = [
	'/autostart',
	'/humanInLoop',
	'/panic',
	'/execution',
	'/stageOrder',
	'/stages',
	'/taskGeneration',
	'/gates'
] as const;

type JsonContainer = Record<string, unknown> | unknown[];

export function validateWorkflowSettingsPatch(patch: JsonPatchOperation[]): void {
	if (!Array.isArray(patch)) {
		throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', 'Patch must be an array of RFC 6902 operations.');
	}

	for (const [index, operation] of patch.entries()) {
		if (!operation || typeof operation !== 'object') {
			throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Patch operation at index ${String(index)} must be an object.`);
		}
		if (operation.op !== 'add' && operation.op !== 'remove' && operation.op !== 'replace') {
			throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Unsupported patch operation '${String((operation as { op?: unknown }).op)}' at index ${String(index)}.`);
		}
		if (typeof operation.path !== 'string' || operation.path.length === 0 || !operation.path.startsWith('/')) {
			throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Patch operation at index ${String(index)} must include a valid JSON pointer path.`);
		}
		if (!isAllowedWorkflowPath(operation.path)) {
			throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Patch path '${operation.path}' is not allowed for workflow settings.`);
		}
		if ((operation.op === 'add' || operation.op === 'replace') && !('value' in operation)) {
			throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Patch operation '${operation.op}' at path '${operation.path}' requires a value.`);
		}
		for (const token of parsePointer(operation.path)) {
			if (token === '__proto__' || token === 'prototype' || token === 'constructor') {
				throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Patch path '${operation.path}' contains a forbidden token.`);
			}
		}
	}
}

export function applyWorkflowSettingsPatch(
	current: WorkflowDefinition,
	patch: JsonPatchOperation[]
): WorkflowDefinition {
	validateWorkflowSettingsPatch(patch);
	const draft = structuredClone(current) as unknown as WorkflowDefinition;

	for (const operation of patch) {
		applyOperation(draft as unknown as JsonContainer, operation);
	}

	return draft;
}

function applyOperation(target: JsonContainer, operation: JsonPatchOperation): void {
	const tokens = parsePointer(operation.path);
	if (tokens.length === 0) {
		throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', 'Patching the root workflow object is not supported.');
	}

	const parentTokens = tokens.slice(0, -1);
	const leafToken = tokens[tokens.length - 1] as string;
	const parent = resolvePointerContainer(target, parentTokens, operation.path);

	if (Array.isArray(parent)) {
		applyArrayOperation(parent, leafToken, operation);
		return;
	}

	applyObjectOperation(parent, leafToken, operation);
}

function applyArrayOperation(target: unknown[], leafToken: string, operation: JsonPatchOperation): void {
	if (leafToken === '-' && operation.op !== 'add') {
		throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Only 'add' may target '-' for path '${operation.path}'.`);
	}

	const index = leafToken === '-' ? target.length : parseArrayIndex(leafToken, operation.path);
	if (operation.op === 'add') {
		if (index < 0 || index > target.length) {
			throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Array add index out of bounds for path '${operation.path}'.`);
		}
		target.splice(index, 0, operation.value);
		return;
	}

	if (index < 0 || index >= target.length) {
		throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Array index out of bounds for path '${operation.path}'.`);
	}

	if (operation.op === 'replace') {
		target[index] = operation.value;
		return;
	}

	target.splice(index, 1);
}

function applyObjectOperation(target: Record<string, unknown>, leafToken: string, operation: JsonPatchOperation): void {
	if (operation.op === 'add') {
		target[leafToken] = operation.value;
		return;
	}

	if (!Object.prototype.hasOwnProperty.call(target, leafToken)) {
		throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Path '${operation.path}' does not exist.`);
	}

	if (operation.op === 'replace') {
		target[leafToken] = operation.value;
		return;
	}

	delete target[leafToken];
}

function resolvePointerContainer(target: JsonContainer, tokens: string[], pathLabel: string): JsonContainer {
	let current: unknown = target;
	for (const token of tokens) {
		if (Array.isArray(current)) {
			const index = parseArrayIndex(token, pathLabel);
			if (index < 0 || index >= current.length) {
				throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Path '${pathLabel}' does not exist.`);
			}
			current = current[index];
			continue;
		}

		if (!current || typeof current !== 'object') {
			throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Path '${pathLabel}' does not exist.`);
		}

		const container = current as Record<string, unknown>;
		if (!Object.prototype.hasOwnProperty.call(container, token)) {
			throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Path '${pathLabel}' does not exist.`);
		}
		current = container[token];
	}

	if (!current || typeof current !== 'object') {
		throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Path '${pathLabel}' does not reference a mutable container.`);
	}

	return current as JsonContainer;
}

function parseArrayIndex(token: string, pathLabel: string): number {
	if (!/^\d+$/u.test(token)) {
		throw new WorkflowSettingsError('SETTINGS_PATCH_INVALID', `Path '${pathLabel}' contains a non-numeric array index '${token}'.`);
	}
	return Number.parseInt(token, 10);
}

function parsePointer(pointer: string): string[] {
	if (!pointer.startsWith('/')) {
		return [];
	}
	return pointer
		.slice(1)
		.split('/')
		.map((token) => token.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

function isAllowedWorkflowPath(pointer: string): boolean {
	return ALLOWED_PATH_PREFIXES.some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`));
}
