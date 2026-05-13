import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Manifest } from './protocol/contracts.js';

const OPEN_MISSION_RUNTIME_DIRECTORY = 'open-mission';
const OPEN_MISSION_DAEMON_MANIFEST_FILE = 'daemon.json';
const OPEN_MISSION_DAEMON_LOCK_FILE = 'daemon.lock';
const OPEN_MISSION_DAEMON_TERMINAL_LEASES_FILE = 'daemon-terminal-leases.json';
const OPEN_MISSION_DAEMON_SESSIONS_DIRECTORY = 'sessions';
const OPEN_MISSION_DAEMON_SOCKET_FILE = 'daemon.sock';
const OPEN_MISSION_DAEMON_LOG_FILE = 'daemon.log';
const OPEN_MISSION_DAEMON_STDOUT_FILE = 'daemon.stdout.log';

export function getDaemonRuntimePath(): string {
	return resolveDaemonRuntimeRoot();
}

export function getDaemonManifestPath(): string {
	return path.join(getDaemonRuntimePath(), OPEN_MISSION_DAEMON_MANIFEST_FILE);
}

export function getDaemonLockPath(): string {
	return path.join(getDaemonRuntimePath(), OPEN_MISSION_DAEMON_LOCK_FILE);
}

export function getDaemonTerminalLeaseStatePath(): string {
	return path.join(getDaemonRuntimePath(), OPEN_MISSION_DAEMON_TERMINAL_LEASES_FILE);
}

export function getDaemonLogPath(): string {
	return path.join(getDaemonRuntimePath(), OPEN_MISSION_DAEMON_LOG_FILE);
}

export function getDaemonStdoutLogPath(): string {
	return path.join(getDaemonRuntimePath(), OPEN_MISSION_DAEMON_STDOUT_FILE);
}

export function getDaemonSessionStatePath(workspaceRoot: string, missionId: string): string {
	return path.join(
		getDaemonRuntimePath(),
		'workspaces',
		createWorkspaceHash(workspaceRoot),
		OPEN_MISSION_DAEMON_SESSIONS_DIRECTORY,
		`${missionId}.json`
	);
}

export function resolveDaemonSocketPath(
	overridePath?: string
): string {
	const normalizedOverride = overridePath?.trim();
	if (normalizedOverride) {
		return path.resolve(normalizedOverride);
	}

	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\open-mission-daemon`;
	}

	return path.join(getDaemonRuntimePath(), OPEN_MISSION_DAEMON_SOCKET_FILE);
}

export function isNamedPipePath(candidatePath: string): boolean {
	return candidatePath.startsWith('\\\\.\\pipe\\');
}

export async function readDaemonManifest(): Promise<Manifest | undefined> {
	try {
		const content = await fs.readFile(getDaemonManifestPath(), 'utf8');
		return JSON.parse(content) as Manifest;
	} catch {
		return undefined;
	}
}

function resolveDaemonRuntimeRoot(): string {
	const xdgRuntimeDirectory = process.env['XDG_RUNTIME_DIR']?.trim();
	if (xdgRuntimeDirectory) {
		return path.join(xdgRuntimeDirectory, OPEN_MISSION_RUNTIME_DIRECTORY);
	}

	return path.join(os.tmpdir(), OPEN_MISSION_RUNTIME_DIRECTORY);
}

function createWorkspaceHash(workspaceRoot: string): string {
	return createHash('sha256')
		.update(path.resolve(workspaceRoot), 'utf8')
		.digest('hex')
		.slice(0, 16);
}