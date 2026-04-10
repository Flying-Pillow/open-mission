import {
	cancel,
	confirm,
	intro,
	isCancel,
	note,
	outro,
	spinner,
	text
} from '@clack/prompts';
import { execFile, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
	ensureMissionUserConfig,
	getMissionUserConfigPath,
	readMissionUserConfig,
	resolveMissionWorkspaceRoot,
	type MissionUserConfig,
	writeMissionUserConfig
} from '@flying-pillow/mission-core';
import type { CommandContext } from './types.js';

const execFileAsync = promisify(execFile);

type ManagedDependencyId = 'zellij' | 'micro';

type ManagedDependency = {
	id: ManagedDependencyId;
	label: string;
	owner: string;
	repo: string;
	executableName: string;
	resolveAssetPattern(): RegExp;
};

export async function ensureMissionInstallation(options: {
	interactive: boolean;
	verbose?: boolean;
}): Promise<MissionUserConfig> {
	const hadConfig = readMissionUserConfig() !== undefined;
	let config = await ensureMissionUserConfig();
	let changed = !hadConfig;

	if (options.verbose) {
		intro('Mission setup');
	}

	const missionWorkspaceRoot = await ensureWorkspaceRoot(config, options.interactive);
	if (missionWorkspaceRoot !== config.missionWorkspaceRoot) {
		config = { ...config, missionWorkspaceRoot };
		changed = true;
	}

	const terminalBinary = await ensureBinary({
		label: 'zellij terminal manager',
		defaultValue: 'zellij',
		interactive: options.interactive,
		...(config.terminalBinary ? { currentValue: config.terminalBinary } : {}),
		managedDependencyId: 'zellij',
		fallbacks: []
	});
	if (terminalBinary !== config.terminalBinary) {
		config = { ...config, terminalBinary };
		changed = true;
	}

	const editorBinary = await ensureBinary({
		label: 'editor',
		defaultValue: 'micro',
		interactive: options.interactive,
		...(config.editorBinary ? { currentValue: config.editorBinary } : {}),
		managedDependencyId: 'micro',
		fallbacks: ['micro', 'nano', 'vim', 'vi']
	});
	if (editorBinary !== config.editorBinary) {
		config = { ...config, editorBinary };
		changed = true;
	}

	if (changed) {
		config = await writeMissionUserConfig(config);
	}

	if (options.verbose) {
		note(
			[
				`config: ${getMissionUserConfigPath()}`,
				`missions: ${resolveMissionWorkspaceRoot(config.missionWorkspaceRoot)}`,
				`terminal: ${config.terminalBinary ?? 'zellij'}`,
				`editor: ${config.editorBinary ?? 'micro'}`
			].join('\n'),
			'Mission setup'
		);
		outro('Mission setup complete.');
	}

	return config;
}

export async function runMissionInstall(context: CommandContext): Promise<void> {
	const config = await ensureMissionInstallation({
		interactive: !context.json && process.stdout.isTTY,
		verbose: !context.json
	});
	if (context.json) {
		process.stdout.write(`${JSON.stringify({
			configPath: getMissionUserConfigPath(),
			config,
			missionsPath: resolveMissionWorkspaceRoot(config.missionWorkspaceRoot)
		}, null, 2)}\n`);
	}
}

async function ensureWorkspaceRoot(config: MissionUserConfig, interactive: boolean): Promise<string> {
	const configuredRoot = config.missionWorkspaceRoot ?? 'missions';
	const resolvedRoot = resolveMissionWorkspaceRoot(configuredRoot);
	try {
		await mkdir(resolvedRoot, { recursive: true });
		return configuredRoot;
	} catch (error) {
		if (!interactive) {
			throw new Error(
				`Mission could not create '${resolvedRoot}'. Run 'mission install' to choose a different mission workspace root.`
			);
		}
		note(
			`${resolvedRoot}\n${error instanceof Error ? error.message : String(error)}`,
			'Mission workspace root'
		);
		const answer = await text({
			message: 'Choose a mission workspace root',
			placeholder: configuredRoot,
			defaultValue: configuredRoot,
			validate(value) {
				const candidate = String(value ?? '').trim();
				if (!candidate) {
					return 'Mission workspace root is required.';
				}
				try {
					const resolvedCandidate = resolveMissionWorkspaceRoot(candidate);
					accessSync(path.dirname(resolvedCandidate), constants.W_OK);
					return;
				} catch {
					return 'Mission needs a writable parent directory for the workspace root.';
				}
			}
		});
		if (isCancel(answer)) {
			cancel('Mission setup cancelled.');
			throw new Error('Mission setup cancelled.');
		}
		return String(answer).trim();
	}
}

async function ensureBinary(input: {
	label: string;
	currentValue?: string;
	defaultValue: string;
	interactive: boolean;
	managedDependencyId?: ManagedDependencyId;
	fallbacks: string[];
}): Promise<string> {
	const configuredBinary = input.currentValue?.trim() || input.defaultValue;
	if (isExecutableAvailable(configuredBinary)) {
		return configuredBinary;
	}
	if (input.managedDependencyId) {
		try {
			return await installManagedDependency(input.managedDependencyId, input.interactive);
		} catch (error) {
			if (!input.interactive) {
				throw error;
			}
			note(
				error instanceof Error ? error.message : String(error),
				`Automatic ${input.label} installation failed`
			);
		}
	}
	const fallbackBinary = input.fallbacks.find((candidate) => isExecutableAvailable(candidate));
	if (fallbackBinary) {
		return fallbackBinary;
	}
	if (!input.interactive) {
		throw new Error(
			`Mission requires ${input.label} ('${configuredBinary}') but it was not found. Run 'mission install' to configure it.`
		);
	}
	const shouldConfigure = await confirm({
		message: `Mission could not find ${input.label} ('${configuredBinary}'). Configure it now?`,
		initialValue: true
	});
	if (isCancel(shouldConfigure) || !shouldConfigure) {
		cancel('Mission setup cancelled.');
		throw new Error(`Mission setup cancelled because ${input.label} is missing.`);
	}
	const answer = await text({
		message: `Enter the ${input.label} command or absolute path`,
		placeholder: configuredBinary,
		defaultValue: configuredBinary,
		validate(value) {
			const candidate = String(value ?? '').trim();
			if (!candidate) {
				return `${input.label} is required.`;
			}
			return isExecutableAvailable(candidate)
				? undefined
				: `Mission could not execute '${candidate}'. Install ${input.label} first or enter a valid command/path.`;
		}
	});
	if (isCancel(answer)) {
		cancel('Mission setup cancelled.');
		throw new Error('Mission setup cancelled.');
	}
	return String(answer).trim();
}

function isExecutableAvailable(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed) {
		return false;
	}
	if (trimmed.includes(path.sep)) {
		try {
			accessSync(trimmed, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	}
	const result = spawnSync('which', [trimmed], {
		encoding: 'utf8',
		stdio: 'ignore'
	});
	return result.status === 0;
}

async function installManagedDependency(
	id: ManagedDependencyId,
	interactive: boolean
): Promise<string> {
	const dependency = getManagedDependency(id);
	const localBinDirectory = path.join(os.homedir(), '.local', 'bin');
	const targetPath = path.join(localBinDirectory, dependency.executableName);
	if (isExecutableAvailable(targetPath)) {
		return targetPath;
	}
	if (!isExecutableAvailable('tar')) {
		throw new Error(`Mission could not install ${dependency.label} automatically because 'tar' is not available on this machine.`);
	}
	const installSpinner = interactive ? spinner() : undefined;
	installSpinner?.start(`Installing ${dependency.label} into ${localBinDirectory}`);
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `mission-install-${id}-`));
	try {
		await mkdir(localBinDirectory, { recursive: true });
		const release = await fetchLatestRelease(dependency);
		const asset = release.assets.find((candidate) => dependency.resolveAssetPattern().test(candidate.name));
		if (!asset) {
			throw new Error(
				`Mission could not find a supported ${dependency.label} release asset for ${process.platform}/${process.arch}.`
			);
		}
		const archivePath = path.join(temporaryRoot, asset.name);
		const extractDirectory = path.join(temporaryRoot, 'extract');
		await mkdir(extractDirectory, { recursive: true });
		await downloadFile(asset.browser_download_url, archivePath);
		await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDirectory], {
			encoding: 'utf8'
		});
		const executablePath = await findExecutable(extractDirectory, dependency.executableName);
		if (!executablePath) {
			throw new Error(`Mission downloaded ${dependency.label} but could not find '${dependency.executableName}' in the archive.`);
		}
		await copyFile(executablePath, targetPath);
		await chmod(targetPath, 0o755);
		installSpinner?.stop(`${dependency.label} installed at ${targetPath}`);
		return targetPath;
	} catch (error) {
		installSpinner?.stop(`Failed to install ${dependency.label}`);
		throw error instanceof Error
			? error
			: new Error(`Mission could not install ${dependency.label}.`);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function getManagedDependency(id: ManagedDependencyId): ManagedDependency {
	if (process.platform !== 'linux') {
		throw new Error(`Mission can only auto-install ${id} on Linux right now. Configure it manually on ${process.platform}.`);
	}
	if (id === 'zellij') {
		return {
			id,
			label: 'zellij terminal manager',
			owner: 'zellij-org',
			repo: 'zellij',
			executableName: 'zellij',
			resolveAssetPattern() {
				if (process.arch === 'x64') {
					return /^zellij-x86_64-unknown-linux-musl\.tar\.gz$/u;
				}
				if (process.arch === 'arm64') {
					return /^zellij-aarch64-unknown-linux-musl\.tar\.gz$/u;
				}
				throw new Error(`Mission cannot auto-install zellij for Linux architecture '${process.arch}'.`);
			}
		};
	}
	return {
		id,
		label: 'micro editor',
		owner: 'micro-editor',
		repo: 'micro',
		executableName: 'micro',
		resolveAssetPattern() {
			if (process.arch === 'x64') {
				return /^micro-.*-linux64-static\.tar\.gz$/u;
			}
			if (process.arch === 'arm64') {
				return /^micro-.*-linux-arm64-static\.tar\.gz$/u;
			}
			throw new Error(`Mission cannot auto-install micro for Linux architecture '${process.arch}'.`);
		}
	};
}

async function fetchLatestRelease(dependency: ManagedDependency): Promise<{
	assets: Array<{ name: string; browser_download_url: string }>;
}> {
	const response = await fetch(`https://api.github.com/repos/${dependency.owner}/${dependency.repo}/releases/latest`, {
		headers: {
			'Accept': 'application/vnd.github+json',
			'User-Agent': 'mission-installer'
		}
	});
	if (!response.ok) {
		throw new Error(
			`Mission could not resolve the latest ${dependency.label} release from GitHub (${response.status} ${response.statusText}).`
		);
	}
	const payload = await response.json() as {
		assets?: Array<{ name?: string; browser_download_url?: string }>;
	};
	return {
		assets: (payload.assets ?? [])
			.filter((asset): asset is { name: string; browser_download_url: string } =>
				typeof asset.name === 'string' && typeof asset.browser_download_url === 'string'
			)
	};
}

async function downloadFile(url: string, destinationPath: string): Promise<void> {
	const response = await fetch(url, {
		headers: {
			'User-Agent': 'mission-installer'
		}
	});
	if (!response.ok) {
		throw new Error(`Mission could not download ${url} (${response.status} ${response.statusText}).`);
	}
	const content = Buffer.from(await response.arrayBuffer());
	await writeFile(destinationPath, content);
}

async function findExecutable(rootPath: string, executableName: string): Promise<string | undefined> {
	const entries = await readdir(rootPath, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(rootPath, entry.name);
		if (entry.isDirectory()) {
			const nestedMatch = await findExecutable(entryPath, executableName);
			if (nestedMatch) {
				return nestedMatch;
			}
			continue;
		}
		if (entry.isFile() && entry.name === executableName) {
			return entryPath;
		}
	}
	return undefined;
}