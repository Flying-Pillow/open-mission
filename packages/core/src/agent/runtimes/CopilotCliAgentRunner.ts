import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { COPILOT_CLI_AGENT_RUNNER_ID } from './AgentRuntimeIds.js';
import {
	AgentRunner,
	type AgentRunnerTerminalTransportRuntimeOptions
} from '../AgentRunner.js';
import type { AgentSession } from '../AgentSession.js';
import type {
	AgentLaunchConfig,
	AgentRunnerCapabilities,
	AgentSessionReference
} from '../AgentRuntimeTypes.js';

export type CopilotCliAgentRunnerOptions = Omit<
	AgentRunnerTerminalTransportRuntimeOptions,
	| 'command'
> & {
	command?: string;
	trustedConfigDir?: string;
	sharedSessionMode?: 'enabled' | 'disabled';
};

const DEFAULT_COPILOT_CLI_ARGS = [
	'--allow-all-paths',
	'--allow-all-tools',
	'--allow-all-urls'
];

export class CopilotCliAgentRunner extends AgentRunner {
	private readonly trustedConfigDir: string;

	public constructor(options: CopilotCliAgentRunnerOptions) {
		super({
			id: COPILOT_CLI_AGENT_RUNNER_ID,
			displayName: `${COPILOT_CLI_AGENT_RUNNER_ID} via terminal-manager`
		});
		this.trustedConfigDir = resolveTrustedConfigDir(options.trustedConfigDir);
		const effectiveArgs = options.args && options.args.length > 0
			? [...DEFAULT_COPILOT_CLI_ARGS, ...options.args]
			: [...DEFAULT_COPILOT_CLI_ARGS];
		const sharedSessionMode = options.sharedSessionMode ?? 'disabled';
		this.configureTerminalTransportRuntime({
			command: options.command?.trim() || process.env['MISSION_COPILOT_CLI_COMMAND']?.trim() || 'copilot',
			args: effectiveArgs,
			discoverSharedSessionName: false,
			...(options.env ? { env: options.env } : {}),
			...(options.sessionPrefix ? { sessionPrefix: options.sessionPrefix } : {}),
			...(options.pollIntervalMs ? { pollIntervalMs: options.pollIntervalMs } : {}),
			...(options.logLine ? { logLine: options.logLine } : {}),
			...(options.terminalBinary ? { terminalBinary: options.terminalBinary } : {}),
			...(sharedSessionMode === 'enabled' && options.sharedSessionName
				? { sharedSessionName: options.sharedSessionName }
				: {}),
			...(options.agentSessionPaneTitle ? { agentSessionPaneTitle: options.agentSessionPaneTitle } : {}),
			...(options.executor ? { executor: options.executor } : {})
		});
	}

	public async getCapabilities(): Promise<AgentRunnerCapabilities> {
		return this.getTerminalCommandCapabilities();
	}

	public async isAvailable(): Promise<{ available: boolean; reason?: string }> {
		return this.isTerminalCommandRuntimeAvailable();
	}

	protected override async onStartSession(config: AgentLaunchConfig): Promise<AgentSession> {
		const trustedDirectories = resolveTrustedDirectories(config.workingDirectory);
		await ensureTrustedFolderConfig(this.trustedConfigDir, trustedDirectories);
		const launchArgs = ['--config-dir', this.trustedConfigDir];
		for (const directory of trustedDirectories) {
			launchArgs.push('--add-dir', directory);
		}
		return this.startTerminalCommandSession(config, {
			launchArgs
		});
	}

	protected override async onReconcileSession(reference: AgentSessionReference): Promise<AgentSession> {
		return this.reconcileTerminalCommandSession(reference);
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
	const configPath = path.join(configDir, 'config.json');
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

	const trustedFolders = Array.isArray(document['trusted_folders'])
		? document['trusted_folders'].filter((value): value is string => typeof value === 'string')
		: [];
	for (const directory of trustedDirectories) {
		if (!trustedFolders.includes(directory)) {
			trustedFolders.push(directory);
		}
	}

	document['trusted_folders'] = trustedFolders;
	await fs.writeFile(configPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}