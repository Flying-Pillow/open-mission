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
import { createHash } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
	ensureMissionConfig,
	getMissionManagedDependenciesRoot,
	getMissionConfigPath,
	readMissionConfig,
	resolveMissionsRoot,
	resolveRepositoriesRoot,
	type MissionConfig,
	writeMissionConfig
} from '@flying-pillow/mission-core/node';

const execFileAsync = promisify(execFile);

type ManagedDependencyId = 'gh';
type ManagedDependencyArchiveType = 'tar.gz' | 'zip';

type ManagedDependency = {
	id: ManagedDependencyId;
	label: string;
	owner: string;
	repo: string;
	releaseTag: string;
	executableName: string;
	archiveType: ManagedDependencyArchiveType;
	resolveAssetPattern(): RegExp;
};

export async function ensureMissionInstallation(options: {
	interactive: boolean;
	verbose?: boolean;
}): Promise<MissionConfig> {
	const hadConfig = readMissionConfig() !== undefined;
	let config = await ensureMissionConfig();
	let changed = !hadConfig;

	if (options.verbose) {
		intro('Mission setup');
	}

	const missionsRoot = await ensureMissionsRoot(config, options.interactive);
	if (missionsRoot !== config.missionsRoot) {
		config = { ...config, missionsRoot };
		changed = true;
	}

	const repositoriesRoot = await ensureRepositoriesRoot(config, options.interactive);
	if (repositoriesRoot !== config.repositoriesRoot) {
		config = { ...config, repositoriesRoot };
		changed = true;
	}

	const ghBinary = await ensureBinary({
		label: 'GitHub CLI',
		defaultValue: 'gh',
		interactive: options.interactive,
		...(config.ghBinary ? { currentValue: config.ghBinary } : {}),
		managedDependencyId: 'gh',
		fallbacks: ['gh']
	});
	if (ghBinary !== config.ghBinary) {
		config = { ...config, ghBinary };
		changed = true;
	}

	if (changed) {
		config = await writeMissionConfig(config);
	}

	if (options.verbose) {
		note(
			[
				`config: ${getMissionConfigPath()}`,
				`missionsRoot: ${resolveMissionsRoot(config)}`,
				`repositoriesRoot: ${resolveRepositoriesRoot(config)}`,
				`managedDependenciesRoot: ${getMissionManagedDependenciesRoot()}`,
				`gh: ${config.ghBinary ?? 'gh'}`
			].join('\n'),
			'Mission setup'
		);
		outro('Mission setup complete.');
	}

	return config;
}

export function getMissionInstallationOutput(config: MissionConfig) {
	return {
		configPath: getMissionConfigPath(),
		config,
		missionsRoot: resolveMissionsRoot(config),
		repositoriesRoot: resolveRepositoriesRoot(config),
		managedDependenciesRoot: getMissionManagedDependenciesRoot()
	};
}

async function ensureMissionsRoot(config: MissionConfig, interactive: boolean): Promise<string> {
	const configuredRoot = config.missionsRoot;
	const resolvedRoot = resolveMissionsRoot(config);
	try {
		await mkdir(resolvedRoot, { recursive: true });
		return configuredRoot;
	} catch (error) {
		if (!interactive) {
			throw new Error(
				`Mission could not create '${resolvedRoot}'. Run 'mission install' to choose a different missions root.`
			);
		}
		note(
			`${resolvedRoot}\n${error instanceof Error ? error.message : String(error)}`,
			'Missions root'
		);
		const answer = await text({
			message: 'Choose a missions root',
			placeholder: configuredRoot,
			defaultValue: configuredRoot,
			validate(value: unknown) {
				const candidate = String(value ?? '').trim();
				if (!candidate) {
					return 'Missions root is required.';
				}
				try {
					const resolvedCandidate = path.resolve(candidate);
					accessSync(path.dirname(resolvedCandidate), constants.W_OK);
					return;
				} catch {
					return 'Mission needs a writable parent directory for the missions root.';
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
	const usesManagedRuntimePath = input.managedDependencyId && input.currentValue?.trim()
		? isManagedDependencyPath(input.currentValue.trim(), input.managedDependencyId)
		: false;
	const hasExplicitOverride = typeof input.currentValue === 'string'
		&& input.currentValue.trim().length > 0
		&& input.currentValue.trim() !== input.defaultValue;
	if (hasExplicitOverride && !usesManagedRuntimePath && isExecutableAvailable(configuredBinary)) {
		return configuredBinary;
	}
	if (isExecutableAvailable(configuredBinary)) {
		return configuredBinary;
	}
	const fallbackBinary = input.fallbacks.find((candidate) => isExecutableAvailable(candidate));
	if (fallbackBinary) {
		return fallbackBinary;
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
		validate(value: unknown) {
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

async function ensureRepositoriesRoot(config: MissionConfig, interactive: boolean): Promise<string> {
	const configuredRoot = config.repositoriesRoot;
	const resolvedRoot = resolveRepositoriesRoot(config);
	try {
		await mkdir(resolvedRoot, { recursive: true });
		return configuredRoot;
	} catch (error) {
		if (!interactive) {
			throw new Error(
				`Mission could not create '${resolvedRoot}'. Run 'mission install' to choose a different repositories root.`
			);
		}
		note(
			`${resolvedRoot}\n${error instanceof Error ? error.message : String(error)}`,
			'Repositories root'
		);
		const answer = await text({
			message: 'Choose a repositories root',
			placeholder: configuredRoot,
			defaultValue: configuredRoot,
			validate(value: unknown) {
				const candidate = String(value ?? '').trim();
				if (!candidate) {
					return 'Repositories root is required.';
				}
				try {
					const resolvedCandidate = path.resolve(candidate);
					accessSync(path.dirname(resolvedCandidate), constants.W_OK);
					return;
				} catch {
					return 'Mission needs a writable parent directory for the repositories root.';
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

function isManagedDependencyPath(candidatePath: string, id: ManagedDependencyId): boolean {
	const normalizedCandidate = path.resolve(candidatePath);
	const dependencyRoot = path.resolve(path.join(getMissionManagedDependenciesRoot(), id));
	return normalizedCandidate === dependencyRoot || normalizedCandidate.startsWith(`${dependencyRoot}${path.sep}`);
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
	const runtimeRoot = resolveManagedDependencyRoot(dependency);
	const targetPath = path.join(runtimeRoot, dependency.executableName);
	if (isExecutableAvailable(targetPath) && isManagedDependencyUsable(targetPath)) {
		return targetPath;
	}
	const extractorBinary = dependency.archiveType === 'tar.gz' ? 'tar' : 'unzip';
	if (!isExecutableAvailable(extractorBinary)) {
		throw new Error(`Mission could not install ${dependency.label} automatically because '${extractorBinary}' is not available on this machine.`);
	}
	const installSpinner = interactive ? spinner() : undefined;
	installSpinner?.start(`Installing ${dependency.label} ${dependency.releaseTag} into ${runtimeRoot}`);
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `mission-install-${id}-`));
	try {
		await mkdir(runtimeRoot, { recursive: true });
		const release = await fetchPinnedRelease(dependency);
		const asset = release.assets.find((candidate) => dependency.resolveAssetPattern().test(candidate.name));
		if (!asset) {
			throw new Error(
				`Mission could not find a supported ${dependency.label} release asset for ${process.platform}/${process.arch}.`
			);
		}
		const archivePath = path.join(temporaryRoot, asset.name);
		const extractDirectory = path.join(temporaryRoot, 'extract');
		await mkdir(extractDirectory, { recursive: true });
		const archiveContent = await downloadFile(asset.browser_download_url, archivePath);
		verifyDownloadedAsset(asset.digest, archiveContent, dependency.label);
		await extractArchive(archivePath, extractDirectory, dependency.archiveType);
		const executablePath = await findExecutable(extractDirectory, dependency.executableName);
		if (!executablePath) {
			throw new Error(`Mission downloaded ${dependency.label} but could not find '${dependency.executableName}' in the archive.`);
		}
		await rm(targetPath, { force: true });
		await copyFile(executablePath, targetPath);
		await chmod(targetPath, 0o755);
		if (!isManagedDependencyUsable(targetPath)) {
			throw new Error(`Mission installed ${dependency.label} at ${targetPath} but it could not be executed on this machine.`);
		}
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
	if (id === 'gh') {
		return {
			id,
			label: 'GitHub CLI',
			owner: 'cli',
			repo: 'cli',
			releaseTag: 'v2.90.0',
			executableName: 'gh',
			archiveType: 'tar.gz',
			resolveAssetPattern() {
				const releaseVersion = '2.90.0';
				if (process.arch === 'x64') {
					return new RegExp(`^gh_${releaseVersion.replace(/\./gu, '\\.')}_linux_amd64\\.tar\\.gz$`, 'u');
				}
				if (process.arch === 'arm64') {
					return new RegExp(`^gh_${releaseVersion.replace(/\./gu, '\\.')}_linux_arm64\\.tar\\.gz$`, 'u');
				}
				throw new Error(`Mission cannot auto-install GitHub CLI for Linux architecture '${process.arch}'.`);
			}
		};
	}
	throw new Error(`Mission does not manage the dependency '${id}'.`);
}

function resolveManagedDependencyRoot(dependency: ManagedDependency): string {
	return path.join(getMissionManagedDependenciesRoot(), dependency.id, dependency.releaseTag);
}

function isManagedDependencyUsable(executablePath: string): boolean {
	const result = spawnSync(executablePath, ['--version'], {
		encoding: 'utf8',
		stdio: 'ignore'
	});
	return result.status === 0;
}

async function fetchPinnedRelease(dependency: ManagedDependency): Promise<{
	assets: Array<{ name: string; browser_download_url: string; digest?: string }>;
}> {
	const response = await fetch(`https://api.github.com/repos/${dependency.owner}/${dependency.repo}/releases/tags/${encodeURIComponent(dependency.releaseTag)}`, {
		headers: {
			'Accept': 'application/vnd.github+json',
			'User-Agent': 'mission-installer'
		}
	});
	if (!response.ok) {
		throw new Error(
			`Mission could not resolve ${dependency.label} ${dependency.releaseTag} from GitHub (${response.status} ${response.statusText}).`
		);
	}
	const payload = await response.json() as {
		assets?: Array<{ name?: string; browser_download_url?: string; digest?: string }>;
	};
	return {
		assets: (payload.assets ?? [])
			.filter((asset): asset is { name: string; browser_download_url: string; digest?: string } =>
				typeof asset.name === 'string' && typeof asset.browser_download_url === 'string'
			)
	};
}

async function downloadFile(url: string, destinationPath: string): Promise<Buffer> {
	const response = await fetch(url, {
		headers: {
			'Accept': 'application/octet-stream',
			'User-Agent': 'mission-installer'
		}
	});
	if (!response.ok) {
		throw new Error(`Mission could not download ${url} (${response.status} ${response.statusText}).`);
	}
	const content = Buffer.from(await response.arrayBuffer());
	await writeFile(destinationPath, content);
	return content;
}

function verifyDownloadedAsset(expectedDigest: string | undefined, content: Buffer, label: string): void {
	if (!expectedDigest?.startsWith('sha256:')) {
		return;
	}
	const expectedHash = expectedDigest.slice('sha256:'.length);
	const observedHash = createHash('sha256').update(content).digest('hex');
	if (observedHash !== expectedHash) {
		throw new Error(`Mission downloaded ${label} but the SHA-256 digest did not match the pinned release asset.`);
	}
}

async function extractArchive(
	archivePath: string,
	extractDirectory: string,
	archiveType: ManagedDependencyArchiveType
): Promise<void> {
	if (archiveType === 'tar.gz') {
		await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDirectory], {
			encoding: 'utf8'
		});
		return;
	}
	await execFileAsync('unzip', ['-q', archivePath, '-d', extractDirectory], {
		encoding: 'utf8'
	});
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