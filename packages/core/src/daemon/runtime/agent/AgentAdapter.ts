import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentInput as CoreAgentInput } from '../../../entities/Agent/AgentSchema.js';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import type { SharedTerminalRegistryOptions } from '../../../entities/Terminal/TerminalRegistry.js';
import type {
    AgentCapabilities,
    AgentLaunchConfig,
    AgentMetadata
} from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type { AgentDeclaredSignalDeliveryType } from '../../../entities/AgentExecution/AgentExecutionSchema.js';

export type AgentAdapterTransportCapabilities = {
    supported: AgentDeclaredSignalDeliveryType[];
    preferred: Partial<Record<'interactive' | 'print', AgentDeclaredSignalDeliveryType>>;
    provisioning: {
        requiresRuntimeConfig: boolean;
        supportsStdioBridge: boolean;
        supportsAgentExecutionScopedTools: boolean;
    };
};

export type AgentExecutionMcpAccess = {
    serverName: 'mission-mcp';
    agentExecutionId: string;
    token: string;
    tools: Array<{ name: string }>;
};

export class ProviderInitializationError extends Error {
    public readonly agentId: string;

    public constructor(agentId: string, message: string) {
        super(message);
        this.name = 'ProviderInitializationError';
        this.agentId = agentId;
    }
}

export type AgentAdapterLaunchPreparation = {
    config: AgentLaunchConfig;
    cleanup?: () => Promise<void>;
};

export type AgentAdapterLaunchPlan = {
    mode: 'interactive' | 'print';
    command: string;
    args: string[];
    stdin?: string;
    env?: NodeJS.ProcessEnv;
};

export type AgentAdapterSettings = {
    model: string;
    launchMode?: 'interactive' | 'print';
    reasoningEffort?: string;
    dangerouslySkipPermissions?: boolean;
    resumeAgentExecution?: string;
    captureAgentExecutions?: boolean;
    providerEnv?: Record<string, string>;
    runtimeEnv?: NodeJS.ProcessEnv;
    launchEnv?: Record<string, string>;
};

export type ResolvedAgentAdapterSettings = {
    model: string;
    launchMode: 'interactive' | 'print';
    reasoningEffort?: string;
    dangerouslySkipPermissions: boolean;
    resumeAgentExecution?: string;
    captureAgentExecutions?: boolean;
    providerEnv: Record<string, string>;
    runtimeEnv: NodeJS.ProcessEnv;
    launchEnv: Record<string, string>;
};

export type AgentAdapterSettingsResolver<TAgentId extends string> = (
    config: AgentLaunchConfig,
    agentId: TAgentId
) => AgentAdapterSettings;

export type AgentAdapterContext = {
    resolveSettings?: AgentAdapterSettingsResolver<string>;
    logLine?: (line: string) => void;
};

export type AgentAdapterArgument = string | {
    setting: 'model' | 'reasoningEffort';
    flag?: string;
} | {
    prompt: 'initial';
    flag?: string;
    omitWhenEmpty?: boolean;
    trim?: boolean;
} | {
    when: 'dangerouslySkipPermissions';
    value: string;
} | {
    trustedConfigDir: true;
    flag?: string;
} | {
    trustedDirectories: true;
    flag: string;
} | {
    launchEnv: string;
    flag?: string;
};

export type AgentAdapterLaunchInput = {
    command?: string;
    args: readonly AgentAdapterArgument[];
};

export type AgentAdapterProviderSettingsInput = {
    reasoningEfforts?: readonly string[];
    allowDangerouslySkipPermissions?: boolean;
    allowCaptureAgentExecutions?: boolean;
    allowResumeAgentExecution?: boolean;
};

export type AgentAdapterTrustedFoldersInput = {
    configDir: string;
};

export type AgentAdapterTerminalOptions = SharedTerminalRegistryOptions & {
    terminalPrefix?: string;
};

export type AgentAdapterRuntimeSignal =
    | {
        type: 'provider-execution';
        providerName: string;
        agentExecutionId: string;
        source: 'provider-structured';
        confidence: 'high';
    }
    | {
        type: 'tool-call';
        toolName: string;
        args: string;
        source: 'provider-structured';
        confidence: 'medium';
    };

export type AgentAdapterRuntimeOutput =
    | { kind: 'message'; channel: 'agent' | 'system'; text: string }
    | { kind: 'signal'; signal: AgentAdapterRuntimeSignal }
    | { kind: 'usage'; payload: AgentMetadata }
    | { kind: 'none' };

export type AgentAdapterInput = {
    command: string;
    interactive: AgentAdapterLaunchInput;
    print?: AgentAdapterLaunchInput;
    defaultLaunchMode?: 'interactive' | 'print';
    providerSettings?: AgentAdapterProviderSettingsInput | false;
    runtimeEnv?: NodeJS.ProcessEnv;
    trustedFolders?: AgentAdapterTrustedFoldersInput;
    parseRuntimeOutputLine?: (line: string, agent: AgentInput) => AgentAdapterRuntimeOutput[];
    parseAgentExecutionUsageContent?: (content: string, agent: AgentInput) => AgentAdapterRuntimeOutput | undefined;
    prepareLaunchConfig?: (config: AgentLaunchConfig, agent: AgentInput, mcpAccess?: AgentExecutionMcpAccess) => AgentAdapterLaunchPreparation | Promise<AgentAdapterLaunchPreparation>;
    transportCapabilities?: AgentAdapterTransportCapabilities;
    terminalOptions?: Partial<AgentAdapterTerminalOptions>;
};

export type AgentInput = CoreAgentInput<AgentAdapterInput>;

export type AgentAdapterOptions = {
    id: string;
    command: string;
    displayName?: string;
    createLaunchPlan(config: AgentLaunchConfig): AgentAdapterLaunchPlan;
    parseRuntimeOutputLine?: (line: string) => AgentAdapterRuntimeOutput[];
    parseAgentExecutionUsageContent?: (content: string) => AgentAdapterRuntimeOutput | undefined;
    prepareLaunchConfig?: (config: AgentLaunchConfig, mcpAccess?: AgentExecutionMcpAccess) => AgentAdapterLaunchPreparation | Promise<AgentAdapterLaunchPreparation>;
    transportCapabilities?: AgentAdapterTransportCapabilities;
    terminalOptions?: Partial<AgentAdapterTerminalOptions>;
};

export class AgentAdapter {
    public readonly id: string;
    public readonly displayName: string;
    private readonly createLaunchPlanHook: (config: AgentLaunchConfig) => AgentAdapterLaunchPlan;
    private readonly parseRuntimeOutputLineHook: ((line: string) => AgentAdapterRuntimeOutput[]) | undefined;
    private readonly parseAgentExecutionUsageContentHook: ((content: string) => AgentAdapterRuntimeOutput | undefined) | undefined;
    private readonly prepareLaunchConfigHook: ((config: AgentLaunchConfig, mcpAccess?: AgentExecutionMcpAccess) => AgentAdapterLaunchPreparation | Promise<AgentAdapterLaunchPreparation>) | undefined;
    private readonly transportCapabilities: AgentAdapterTransportCapabilities;
    public readonly terminalOptions: Partial<AgentAdapterTerminalOptions>;

    public constructor(options: AgentAdapterOptions) {
        this.id = options.id.trim();
        this.displayName = options.displayName?.trim() || this.id;
        if (!this.id) {
            throw new ProviderInitializationError('unknown', 'AgentAdapter requires a non-empty id.');
        }
        if (!options.command.trim()) {
            throw new ProviderInitializationError(this.id, `AgentAdapter '${this.id}' requires a non-empty command.`);
        }
        this.createLaunchPlanHook = options.createLaunchPlan;
        this.parseRuntimeOutputLineHook = options.parseRuntimeOutputLine;
        this.parseAgentExecutionUsageContentHook = options.parseAgentExecutionUsageContent;
        this.prepareLaunchConfigHook = options.prepareLaunchConfig;
        this.transportCapabilities = options.transportCapabilities ?? {
            supported: ['stdout-marker'],
            preferred: {
                interactive: 'stdout-marker',
                print: 'stdout-marker'
            },
            provisioning: {
                requiresRuntimeConfig: false,
                supportsStdioBridge: false,
                supportsAgentExecutionScopedTools: false
            }
        };
        this.terminalOptions = { ...(options.terminalOptions ?? {}) };
    }

    public getCapabilities(): Promise<AgentCapabilities> {
        return Promise.resolve(AgentExecution.capabilities());
    }

    public getTransportCapabilities(): AgentAdapterTransportCapabilities {
        return {
            supported: [...this.transportCapabilities.supported],
            preferred: { ...this.transportCapabilities.preferred },
            provisioning: { ...this.transportCapabilities.provisioning }
        };
    }

    public isAvailable(): Promise<{ available: boolean; reason?: string }> {
        return Promise.resolve({ available: true });
    }

    public async validateLaunchConfig(config: AgentLaunchConfig): Promise<void> {
        validateCommonLaunchConfig(config, this.displayName);
        await this.prepareLaunchConfigHook?.(config);
        this.createLaunchPlan(config);
    }

    public createLaunchPlan(config: AgentLaunchConfig): AgentAdapterLaunchPlan {
        validateCommonLaunchConfig(config, this.displayName);
        return this.createLaunchPlanHook(config);
    }

    public parseRuntimeOutputLine(line: string): AgentAdapterRuntimeOutput[] {
        return this.parseRuntimeOutputLineHook?.(line) ?? [{ kind: 'none' }];
    }

    public parseAgentExecutionUsageContent(content: string): AgentAdapterRuntimeOutput | undefined {
        return this.parseAgentExecutionUsageContentHook?.(content);
    }

    public async prepareLaunchConfig(config: AgentLaunchConfig, mcpAccess?: AgentExecutionMcpAccess): Promise<AgentAdapterLaunchPreparation> {
        return this.prepareLaunchConfigHook ? this.prepareLaunchConfigHook(config, mcpAccess) : { config };
    }
}

export function createAgentAdapter(agent: AgentInput, context: AgentAdapterContext = {}): AgentAdapter {
    const trustedFolders = agent.adapter.trustedFolders;
    return new AgentAdapter({
        id: agent.agentId,
        command: agent.adapter.command,
        displayName: agent.displayName,
        createLaunchPlan: (config) => createConfiguredLaunchPlan(config, context, agent),
        ...(agent.adapter.parseRuntimeOutputLine
            ? { parseRuntimeOutputLine: (line: string) => agent.adapter.parseRuntimeOutputLine?.(line, agent) ?? [{ kind: 'none' }] }
            : {}),
        ...(agent.adapter.parseAgentExecutionUsageContent
            ? { parseAgentExecutionUsageContent: (content: string) => agent.adapter.parseAgentExecutionUsageContent?.(content, agent) }
            : {}),
        prepareLaunchConfig: (config: AgentLaunchConfig, mcpAccess?: AgentExecutionMcpAccess) => prepareAgentLaunchConfig(config, agent, trustedFolders, mcpAccess),
        ...(agent.adapter.transportCapabilities ? { transportCapabilities: agent.adapter.transportCapabilities } : {}),
        terminalOptions: {
            ...(agent.adapter.terminalOptions ?? {}),
            ...(context.logLine ? { logLine: context.logLine } : {})
        }
    });
}

async function prepareAgentLaunchConfig(
    config: AgentLaunchConfig,
    agent: AgentInput,
    trustedFolders: AgentAdapterTrustedFoldersInput | undefined,
    mcpAccess: AgentExecutionMcpAccess | undefined
): Promise<AgentAdapterLaunchPreparation> {
    let prepared: AgentAdapterLaunchPreparation = { config };
    if (trustedFolders) {
        prepared = await prepareConfiguredLaunchConfig(prepared.config, trustedFolders);
    }
    if (agent.adapter.prepareLaunchConfig) {
        const adapterPrepared = await agent.adapter.prepareLaunchConfig(prepared.config, agent, mcpAccess);
        const cleanup = combineCleanup(prepared.cleanup, adapterPrepared.cleanup);
        prepared = {
            config: adapterPrepared.config,
            ...(cleanup
                ? { cleanup }
                : {})
        };
    }
    return prepared;
}

function validateCommonLaunchConfig(config: AgentLaunchConfig, displayName: string): void {
    if (!config.workingDirectory.trim()) {
        throw new Error(`${displayName} requires a working directory.`);
    }
    switch (config.scope.kind) {
        case 'system':
            break;
        case 'repository':
            if (!config.scope.repositoryRootPath.trim()) {
                throw new Error(`${displayName} requires a repository root for repository-scoped execution.`);
            }
            break;
        case 'mission':
            if (!config.scope.missionId.trim()) {
                throw new Error(`${displayName} requires a mission identifier for mission-scoped execution.`);
            }
            break;
        case 'task':
            if (!config.scope.missionId.trim() || !config.scope.taskId.trim()) {
                throw new Error(`${displayName} requires mission and task identifiers for task-scoped execution.`);
            }
            break;
        case 'artifact':
            if (!config.scope.artifactId.trim()) {
                throw new Error(`${displayName} requires an artifact identifier for artifact-scoped execution.`);
            }
            break;
    }
    if (config.scope.kind === 'task' && !config.task) {
        throw new Error(`${displayName} requires task context for task-scoped execution.`);
    }
    if (config.task) {
        if (!config.task.taskId.trim()) {
            throw new Error(`${displayName} requires a task identifier.`);
        }
        if (!config.task.stageId.trim()) {
            throw new Error(`${displayName} requires a stage identifier.`);
        }
        if (!config.task.title.trim()) {
            throw new Error(`${displayName} requires a task title.`);
        }
        if (!config.task.instruction.trim()) {
            throw new Error(`${displayName} requires task instructions.`);
        }
    }
    if (config.specification && !config.specification.summary.trim()) {
        throw new Error(`${displayName} requires a specification summary when specification context is provided.`);
    }
}

function createConfiguredLaunchPlan(config: AgentLaunchConfig, context: AgentAdapterContext, agent: AgentInput): AgentAdapterLaunchPlan {
    const settings = resolveConfiguredProviderSettings(config, context, agent);
    const launchInput = settings.launchMode === 'print'
        ? agent.adapter.print ?? agent.adapter.interactive
        : agent.adapter.interactive;
    const env = mergeRuntimeLaunchEnv(agent.adapter.runtimeEnv, settings);
    return {
        mode: settings.launchMode,
        command: launchInput.command?.trim() || agent.adapter.command,
        args: buildLaunchArgs({ config, agent, settings, launchInput }),
        ...(env ? { env } : {})
    };
}

function resolveConfiguredProviderSettings(config: AgentLaunchConfig, context: AgentAdapterContext, agent: AgentInput): ResolvedAgentAdapterSettings {
    if (agent.adapter.providerSettings === false) {
        return {
            model: '',
            launchMode: agent.adapter.defaultLaunchMode ?? 'interactive',
            dangerouslySkipPermissions: false,
            providerEnv: {},
            runtimeEnv: agent.adapter.runtimeEnv ?? process.env,
            launchEnv: config.launchEnv ?? {}
        };
    }
    const settingsInput = agent.adapter.providerSettings ?? {};
    const settings = resolveAgentAdapterSettings({
        config,
        agentId: agent.agentId,
        ...(context.resolveSettings ? { resolveSettings: context.resolveSettings } : {})
    });
    validateReasoningEffort(agent.agentId, settings.reasoningEffort, settingsInput.reasoningEfforts);
    if (settings.dangerouslySkipPermissions && !settingsInput.allowDangerouslySkipPermissions) {
        throw new ProviderInitializationError(agent.agentId, `Adapter '${agent.agentId}' does not support configurable permission bypass.`);
    }
    if (settings.captureAgentExecutions && !settingsInput.allowCaptureAgentExecutions) {
        throw new ProviderInitializationError(agent.agentId, `Adapter '${agent.agentId}' does not support AgentExecution capture.`);
    }
    if (settings.resumeAgentExecution && !settingsInput.allowResumeAgentExecution) {
        throw new ProviderInitializationError(agent.agentId, `Adapter '${agent.agentId}' does not support AgentExecution resume.`);
    }
    validateCaptureAgentExecutions(agent.agentId, settings.captureAgentExecutions);
    validateDangerouslySkipPermissions(agent.agentId, settings.dangerouslySkipPermissions);
    return settings;
}

function buildLaunchArgs(input: { config: AgentLaunchConfig; agent: AgentInput; settings: ResolvedAgentAdapterSettings; launchInput: AgentAdapterLaunchInput }): string[] {
    const args: string[] = [];
    for (const argument of input.launchInput.args) {
        if (typeof argument === 'string') {
            args.push(argument);
            continue;
        }
        if ('setting' in argument) {
            const value = argument.setting === 'model' ? input.settings.model : input.settings.reasoningEffort;
            if (value?.trim()) {
                if (argument.flag) {
                    args.push(argument.flag);
                }
                args.push(value.trim());
            }
            continue;
        }
        if ('prompt' in argument) {
            const raw = input.config.initialPrompt?.text ?? input.config.task?.instruction ?? '';
            const prompt = argument.trim ? raw.trim() : raw;
            if (!prompt && argument.omitWhenEmpty) {
                continue;
            }
            if (argument.flag) {
                args.push(argument.flag);
            }
            args.push(prompt);
            continue;
        }
        if ('when' in argument) {
            if (argument.when === 'dangerouslySkipPermissions' && input.settings.dangerouslySkipPermissions) {
                args.push(argument.value);
            }
            continue;
        }
        if ('trustedConfigDir' in argument) {
            const configDir = input.agent.adapter.trustedFolders?.configDir;
            if (!configDir) {
                throw new ProviderInitializationError(input.agent.agentId, `Adapter '${input.agent.agentId}' requires trusted folders config.`);
            }
            if (argument.flag) {
                args.push(argument.flag);
            }
            args.push(configDir);
            continue;
        }
        if ('launchEnv' in argument) {
            const value = input.settings.launchEnv[argument.launchEnv]?.trim();
            if (value) {
                if (argument.flag) {
                    args.push(argument.flag);
                }
                args.push(value);
            }
            continue;
        }
        const trustedDirectories = resolveTrustedDirectories(input.config.workingDirectory);
        for (const directory of trustedDirectories) {
            args.push(argument.flag, directory);
        }
    }
    if (input.settings.resumeAgentExecution) {
        throw new ProviderInitializationError(input.agent.agentId, `Adapter '${input.agent.agentId}' does not support resumeAgentExecution for interactive launch plans.`);
    }
    return args;
}

function combineCleanup(
    first: (() => Promise<void>) | undefined,
    second: (() => Promise<void>) | undefined
): (() => Promise<void>) | undefined {
    if (!first) {
        return second;
    }
    if (!second) {
        return first;
    }
    return async () => {
        await second();
        await first();
    };
}

async function prepareConfiguredLaunchConfig(config: AgentLaunchConfig, trustedFolders: AgentAdapterTrustedFoldersInput): Promise<AgentAdapterLaunchPreparation> {
    await ensureTrustedFolderConfig(trustedFolders.configDir, resolveTrustedDirectories(config.workingDirectory));
    return { config };
}

function resolveAgentAdapterSettings<TAgentId extends string>(input: { config: AgentLaunchConfig; agentId: TAgentId; resolveSettings?: AgentAdapterSettingsResolver<TAgentId> }): ResolvedAgentAdapterSettings {
    const raw = input.resolveSettings
        ? input.resolveSettings(input.config, input.agentId)
        : { model: process.env['MISSION_DEFAULT_MODEL']?.trim() || '', launchMode: 'interactive' as const, runtimeEnv: process.env };
    const model = raw.model?.trim();
    if (!model) {
        throw new ProviderInitializationError(input.agentId, `Adapter '${input.agentId}' requires a non-empty provider model.`);
    }
    return {
        model,
        launchMode: raw.launchMode ?? 'interactive',
        ...(raw.reasoningEffort ? { reasoningEffort: raw.reasoningEffort.trim() } : {}),
        dangerouslySkipPermissions: raw.dangerouslySkipPermissions ?? false,
        ...(raw.resumeAgentExecution?.trim() ? { resumeAgentExecution: raw.resumeAgentExecution.trim() } : {}),
        ...(raw.captureAgentExecutions !== undefined ? { captureAgentExecutions: raw.captureAgentExecutions } : {}),
        providerEnv: validateStringRecord(input.agentId, raw.providerEnv, 'resolved provider env'),
        runtimeEnv: sanitizeProcessEnv(raw.runtimeEnv),
        launchEnv: validateStringRecord(input.agentId, { ...(raw.launchEnv ?? {}), ...(input.config.launchEnv ?? {}) }, 'launch env')
    };
}

function validateReasoningEffort(agentId: string, value: string | undefined, allowedValues: readonly string[] | undefined): void {
    if (value === undefined) {
        return;
    }
    if (!allowedValues) {
        throw new ProviderInitializationError(agentId, `Adapter '${agentId}' does not support a reasoning effort option.`);
    }
    if (!allowedValues.includes(value)) {
        throw new ProviderInitializationError(agentId, `Adapter '${agentId}' received unsupported reasoning effort '${value}'.`);
    }
}

function validateCaptureAgentExecutions(agentId: string, value: boolean | undefined): void {
    if (value !== undefined && agentId !== 'claude-code' && value) {
        throw new ProviderInitializationError(agentId, `Adapter '${agentId}' does not support enabling AgentExecution capture.`);
    }
}

function validateDangerouslySkipPermissions(agentId: string, value: boolean | undefined): void {
    if (value && agentId !== 'claude-code') {
        throw new ProviderInitializationError(agentId, `Adapter '${agentId}' does not support configurable permission bypass.`);
    }
}

function mergeRuntimeLaunchEnv(runtimeEnv: NodeJS.ProcessEnv | undefined, settings: ResolvedAgentAdapterSettings): NodeJS.ProcessEnv | undefined {
    const merged = { ...(runtimeEnv ?? settings.runtimeEnv), ...settings.providerEnv, ...settings.launchEnv };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

export function parseJsonLine(line: string): Record<string, unknown> | undefined {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

export function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
    const value = record[key];
    return isRecord(value) ? value : undefined;
}

export function getStringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
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
        trustedFolders.add(directory);
    }

    const trustedFolderList = [...trustedFolders];
    document['trusted_folders'] = trustedFolderList;
    document['trustedFolders'] = trustedFolderList;
    await fs.writeFile(configPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStringRecord(agentId: string, value: Record<string, string> | undefined, label: string): Record<string, string> {
    if (value === undefined) {
        return {};
    }
    if (!isRecord(value)) {
        throw new ProviderInitializationError(agentId, `Adapter '${agentId}' requires ${label} to be a string record.`);
    }
    const env: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== 'string') {
            throw new ProviderInitializationError(agentId, `Adapter '${agentId}' requires ${label}['${key}'] to be a string.`);
        }
        env[key] = entry;
    }
    return env;
}

function sanitizeProcessEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
    const normalized: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(env ?? {})) {
        if (typeof value === 'string') {
            normalized[key] = value;
        }
    }
    return normalized;
}

function readStringArrayConfig(document: Record<string, unknown>, key: string): string[] {
    const raw = document[key];
    return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
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
            resolved.add(normalized);
        }
    }
    return [...resolved];
}
