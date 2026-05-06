import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	type AgentProviderObservation
} from '../AgentProviderObservations.js';
import type { AgentLaunchConfig } from '../AgentRuntimeTypes.js';
import { COPILOT_CLI_AGENT_RUNNER_ID } from './AgentRuntimeIds.js';
import {
	MissionAgentPtyRunner,
	type MissionAgentRunnerLaunchPlan
} from './MissionAgentPtyRunner.js';

export type CopilotCliAgentRunnerOptions = Omit<
	ConstructorParameters<typeof MissionAgentPtyRunner>[0],
	| 'id'
	| 'command'
> & {
	command?: string;
	trustedConfigDir?: string;
	env?: NodeJS.ProcessEnv;
};

const DEFAULT_COPILOT_CLI_ARGS = [
	'--allow-all-paths',
	'--allow-all-tools',
	'--allow-all-urls'
];
export class CopilotCliAgentRunner extends MissionAgentPtyRunner {
	private readonly launchCommand: string;

	private readonly trustedConfigDir: string;

	private readonly runtimeEnv: NodeJS.ProcessEnv | undefined;

	public constructor(options: CopilotCliAgentRunnerOptions = {}) {
		const launchCommand = options.command?.trim() || process.env['MISSION_COPILOT_CLI_COMMAND']?.trim() || 'copilot';
		super({
			id: COPILOT_CLI_AGENT_RUNNER_ID,
			command: launchCommand,
			displayName: `${COPILOT_CLI_AGENT_RUNNER_ID} via PTY transport`,
			...(options.mcpProvisioner ? { mcpProvisioner: options.mcpProvisioner } : {}),
			...(options.mcpProvisioningPolicy ? { mcpProvisioningPolicy: options.mcpProvisioningPolicy } : {}),
			...(options.allowedMcpTools ? { allowedMcpTools: options.allowedMcpTools } : {}),
			...(options.sessionPrefix ? { sessionPrefix: options.sessionPrefix } : {}),
			...(options.pollIntervalMs ? { pollIntervalMs: options.pollIntervalMs } : {}),
			...(options.logLine ? { logLine: options.logLine } : {}),
			...(options.terminalBinary ? { terminalBinary: options.terminalBinary } : {}),
			...(options.sharedSessionName ? { sharedSessionName: options.sharedSessionName } : {}),
			...(options.agentSessionPaneTitle ? { agentSessionPaneTitle: options.agentSessionPaneTitle } : {}),
			...(options.discoverSharedSessionName !== undefined
				? { discoverSharedSessionName: options.discoverSharedSessionName }
				: {}),
			...(options.executor ? { executor: options.executor } : {}),
			...(options.spawn ? { spawn: options.spawn } : {})
		});
		this.launchCommand = launchCommand;
		this.trustedConfigDir = resolveTrustedConfigDir(options.trustedConfigDir);
		this.runtimeEnv = options.env;
	}

	public createInteractiveLaunchPlan(config: AgentLaunchConfig): MissionAgentRunnerLaunchPlan {
		const trustedDirectories = resolveTrustedDirectories(config.workingDirectory);
		const args = [
			...DEFAULT_COPILOT_CLI_ARGS,
			'--config-dir',
			this.trustedConfigDir
		];
		for (const directory of trustedDirectories) {
			args.push('--add-dir', directory);
		}
		const initialPromptText = config.initialPrompt?.text.trim();
		if (initialPromptText) {
			args.push('-i', initialPromptText);
		}
		return {
			mode: 'interactive',
			command: this.launchCommand,
			args,
			env: this.readRuntimeEnv(config.launchEnv)
		};
	}

	protected override async onStartSession(config: AgentLaunchConfig) {
		const trustedDirectories = resolveTrustedDirectories(config.workingDirectory);
		await ensureTrustedFolderConfig(this.trustedConfigDir, trustedDirectories);
		return super.onStartSession(config);
	}

	protected override parseRuntimeOutputLine(_line: string): AgentProviderObservation[] {
		return [{ kind: 'none' }];
	}

	private readRuntimeEnv(launchEnv: Record<string, string> | undefined): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = {};
		for (const [key, value] of Object.entries({
			...process.env,
			...(this.runtimeEnv ?? {}),
			...(launchEnv ?? {})
		})) {
			if (typeof value === 'string') {
				env[key] = value;
			}
		}
		return env;
	}
}

function resolveTrustedConfigDir(override: string | undefined): string {
	const explicit = override?.trim();
	if (explicit) {
		return path.resolve(explicit);
	}
	const fromEnv = process.env['MISSION_COPILOT_CONFIG_DIR']?.trim();
	if (fromEnv) {
		return path.resolve(fromEnv);
	}
	return path.join(os.homedir(), '.mission', 'copilot-cli');
}

function resolveTrustedDirectories(workingDirectory: string): string[] {
	const resolvedWorkingDirectory = path.resolve(workingDirectory);
	const trustedDirectories = new Set<string>([resolvedWorkingDirectory]);
	const missionMarker = `${path.sep}.mission${path.sep}missions${path.sep}`;
	const markerIndex = resolvedWorkingDirectory.indexOf(missionMarker);
	if (markerIndex > 0) {
		trustedDirectories.add(resolvedWorkingDirectory.slice(0, markerIndex));
	}
	return [...trustedDirectories];
}

async function ensureTrustedFolderConfig(configDir: string, trustedDirectories: string[]): Promise<void> {
	const configPath = path.join(configDir, 'settings.json');
	await fs.mkdir(configDir, { recursive: true });

	let document: Record<string, unknown> = {};
	try {
		const content = await fs.readFile(configPath, 'utf8');
		document = JSON.parse(content) as Record<string, unknown>;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}

	const trustedFolders = new Set<string>([
		...readStringArrayConfig(document, 'trusted_folders'),
		...readStringArrayConfig(document, 'trustedFolders')
	]);
	for (const directory of await resolveCanonicalTrustedDirectories(trustedDirectories)) {
		if (!trustedFolders.has(directory)) {
			trustedFolders.add(directory);
		}
	}

	const trustedFolderList = [...trustedFolders];
	document['trusted_folders'] = trustedFolderList;
	document['trustedFolders'] = trustedFolderList;
	await fs.writeFile(configPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function readStringArrayConfig(document: Record<string, unknown>, key: string): string[] {
	const raw = document[key];
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter((value): value is string => typeof value === 'string');
}

async function resolveCanonicalTrustedDirectories(trustedDirectories: string[]): Promise<string[]> {
	const resolved = new Set<string>();
	for (const directory of trustedDirectories) {
		const normalized = path.resolve(directory);
		if (normalized) {
			resolved.add(normalized);
		}
		try {
			const real = await fs.realpath(normalized);
			if (real) {
				resolved.add(real);
			}
		} catch {
			// Keep the normalized path when realpath resolution is unavailable.
		}
	}
	return [...resolved];
}
