import { describe, expect, it } from 'vitest';
import { resolveHeaderWorkspaceLabel } from './headerDomain.js';

describe('resolveHeaderWorkspaceLabel', () => {
	it('returns only the repository slug when githubRepository is owner/repo', () => {
		const label = resolveHeaderWorkspaceLabel(
			{
				trackingProvider: 'github',
				githubRepository: 'flying-pillow/mission'
			} as never,
			'/tmp/workspace'
		);
		expect(label).toBe('mission');
	});

	it('falls back to workspace root when githubRepository is unavailable', () => {
		const label = resolveHeaderWorkspaceLabel(undefined, '/tmp/workspace');
		expect(label).toBe('/tmp/workspace');
	});
});
