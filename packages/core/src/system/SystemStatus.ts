import { spawnSync } from 'node:child_process';
import type { SystemStatus } from '../types.js';

let cachedSystemStatus: { checkedAt: number; status: SystemStatus } | undefined;

export function readSystemStatus(options: { cwd?: string } = {}): SystemStatus {
	const now = Date.now();
	if (cachedSystemStatus && now - cachedSystemStatus.checkedAt < 10_000) {
		return structuredClone(cachedSystemStatus.status);
	}

	const cwd = options.cwd?.trim() || process.cwd();
	const authResult = spawnSync('gh', ['auth', 'status'], {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const detail = `${authResult.stdout ?? ''}${authResult.stderr ?? ''}`
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	const authenticated = authResult.status === 0;
	let user = parseGitHubAuthUser(`${authResult.stdout ?? ''}\n${authResult.stderr ?? ''}`);
	if (authenticated && !user) {
		const userResult = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		});
		const fallbackUser = userResult.status === 0
			? userResult.stdout.trim()
			: '';
		if (fallbackUser.length > 0) {
			user = fallbackUser;
		}
	}

	const status: SystemStatus = {
		github: {
			cliAvailable: !(authResult.error && 'code' in authResult.error && authResult.error.code === 'ENOENT'),
			authenticated,
			...(user ? { user } : {}),
			...(detail
				? { detail }
				: authResult.error && 'code' in authResult.error && authResult.error.code === 'ENOENT'
					? { detail: 'GitHub CLI is not installed.' }
					: authenticated
						? { detail: 'GitHub CLI authenticated.' }
						: { detail: 'GitHub CLI authentication is required.' })
		}
	};

	cachedSystemStatus = {
		checkedAt: now,
		status
	};
	return structuredClone(status);
}

function parseGitHubAuthUser(output: string): string | undefined {
	const patterns = [
		/Logged in to\s+[^\s]+\s+as\s+([A-Za-z0-9-]+)/iu,
		/Logged in to [^\s]+ account\s+([A-Za-z0-9-]+)/u,
		/\baccount\s+([A-Za-z0-9-]+)\b/iu,
		/as\s+([A-Za-z0-9-]+)\s*\(/u,
		/account\s+([A-Za-z0-9-]+)\s*\(/u,
		/\u2713\s+Logged in to\s+[^\s]+\s+account\s+([A-Za-z0-9-]+)/iu,
		/\u2713\s+Logged in to\s+[^\s]+\s+as\s+([A-Za-z0-9-]+)/iu
	];
	const normalizedOutput = output.replace(/\u001b\[[0-9;]*m/gu, '');
	for (const pattern of patterns) {
		const match = pattern.exec(normalizedOutput);
		const resolvedUser = match?.[1]?.trim();
		if (resolvedUser) {
			return resolvedUser;
		}
	}
	return undefined;
}