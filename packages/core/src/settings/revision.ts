import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkflowSettingsRevisionToken } from './types.js';

export type WorkflowSettingsFileRevision = {
	exists: boolean;
	token: WorkflowSettingsRevisionToken;
	lastUpdatedAt: string;
	size: number;
	mtimeMs: number;
	contentHash?: string;
};

export async function readWorkflowSettingsRevision(
	settingsPath: string
): Promise<WorkflowSettingsFileRevision> {
	try {
		const [content, stat] = await Promise.all([
			fs.readFile(settingsPath),
			fs.stat(settingsPath)
		]);
		const contentHash = createHash('sha256').update(content).digest('hex');
		const token = createHash('sha256')
			.update(path.resolve(settingsPath), 'utf8')
			.update('\u0000', 'utf8')
			.update(contentHash, 'utf8')
			.update('\u0000', 'utf8')
			.update(String(stat.size), 'utf8')
			.update('\u0000', 'utf8')
			.update(String(stat.mtimeMs), 'utf8')
			.digest('hex');

		return {
			exists: true,
			token,
			lastUpdatedAt: new Date(stat.mtimeMs).toISOString(),
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			contentHash
		};
	} catch (error) {
		if (isMissingFileError(error)) {
			return {
				exists: false,
				token: createMissingWorkflowSettingsRevisionToken(settingsPath),
				lastUpdatedAt: new Date(0).toISOString(),
				size: 0,
				mtimeMs: 0
			};
		}

		throw error;
	}
}

export function createMissingWorkflowSettingsRevisionToken(
	settingsPath: string
): WorkflowSettingsRevisionToken {
	return createHash('sha256')
		.update('missing', 'utf8')
		.update('\u0000', 'utf8')
		.update(path.resolve(settingsPath), 'utf8')
		.digest('hex');
}

export function isWorkflowSettingsRevisionMatch(
	expectedRevision: WorkflowSettingsRevisionToken,
	actualRevision: WorkflowSettingsRevisionToken
): boolean {
	return expectedRevision === actualRevision;
}

function isMissingFileError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}