import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const HELPER_RELATIVE_PATHS = [
	path.join('prebuilds', 'darwin-x64', 'spawn-helper'),
	path.join('prebuilds', 'darwin-arm64', 'spawn-helper')
];

await repairNodePtyHelperPermissions();

async function repairNodePtyHelperPermissions() {
	if (process.platform !== 'darwin') {
		return;
	}

	const require = createRequire(import.meta.url);
	let packageJsonPath;
	try {
		packageJsonPath = require.resolve('node-pty/package.json');
	} catch {
		return;
	}

	const packageRoot = path.dirname(packageJsonPath);
	for (const relativePath of HELPER_RELATIVE_PATHS) {
		const helperPath = path.join(packageRoot, relativePath);
		await ensureExecutable(helperPath);
	}
}

async function ensureExecutable(helperPath) {
	let stats;
	try {
		stats = await fs.stat(helperPath);
	} catch {
		return;
	}

	const nextMode = stats.mode | 0o111;
	if (nextMode === stats.mode) {
		return;
	}

	await fs.chmod(helperPath, nextMode);
	process.stdout.write(`[postinstall] restored executable bit on ${helperPath}\n`);
}