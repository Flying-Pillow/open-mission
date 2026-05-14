import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { getDefaultOpenMissionConfig, getOpenMissionGitHubCliBinary, readOpenMissionConfig, resolveRepositoriesRoot } from '../../settings/OpenMissionInstall.js';
import { getDaemonRuntimePath } from '../../daemon/daemonPaths.js';
import { PROTOCOL_VERSION } from '../../daemon/protocol/contracts.js';
import type {
    DaemonRuntimeLease,
    DaemonRuntimeOwnerReference,
    DaemonRuntimeSupervisionSnapshot
} from '../../daemon/runtime/DaemonRuntimeSupervisionSchema.js';
import type { AgentExecutionRuntimeSummary } from '../../daemon/runtime/agent-execution/AgentExecutionRegistry.js';
import { systemConfigSchema, systemStateSchema, type RuntimeSystemState, type SystemConfig, type SystemState } from './SystemSchema.js';

const GITHUB_CLI_TIMEOUT_MS = 1_500;
const SYSTEM_STATUS_CACHE_TTL_MS = 10_000;

type CachedSystemStatusEntry = {
    checkedAt: number;
    status: SystemState;
};

export type SystemStatusRuntimeOptions = {
    daemon?: {
        pid?: number;
        startedAt?: string;
        socketPath?: string;
        runtimePath?: string;
        protocolVersion?: number;
    };
    runtimeSupervision?: DaemonRuntimeSupervisionSnapshot;
    loadedRepositoryCount?: number;
    loadedMissionCount?: number;
    activeAgentExecutionCount?: number;
    agentExecutionSummary?: AgentExecutionRuntimeSummary;
    surreal?: RuntimeSystemState['surreal'];
};

export type SystemStatusReadOptions = {
    cwd?: string;
    authToken?: string;
    runtime?: SystemStatusRuntimeOptions;
};

const cachedSystemStatusByKey = new Map<string, CachedSystemStatusEntry>();

export function readSystemStatus(options: SystemStatusReadOptions = {}): SystemState {
    const now = Date.now();
    const authToken = options.authToken?.trim();
    const cwd = options.cwd?.trim() || process.cwd();
    const ghBinary = getOpenMissionGitHubCliBinary() ?? 'gh';
    const cacheKey = createSystemStatusCacheKey({
        cwd,
        ghBinary,
        ...(authToken ? { authToken } : {})
    });
    const cachedSystemStatus = cachedSystemStatusByKey.get(cacheKey);
    if (cachedSystemStatus && now - cachedSystemStatus.checkedAt < SYSTEM_STATUS_CACHE_TTL_MS) {
        return structuredClone(withVolatileSystemStatus(cachedSystemStatus.status, options.runtime));
    }

    return refreshSystemStatus({ cwd, ...(authToken ? { authToken } : {}), ...(options.runtime ? { runtime: options.runtime } : {}) });
}

export function refreshSystemStatus(options: SystemStatusReadOptions = {}): SystemState {
    const authToken = options.authToken?.trim();
    const cwd = options.cwd?.trim() || process.cwd();
    const ghBinary = getOpenMissionGitHubCliBinary() ?? 'gh';
    const cacheKey = createSystemStatusCacheKey({
        cwd,
        ghBinary,
        ...(authToken ? { authToken } : {})
    });

    const status = withVolatileSystemStatus(authToken
        ? readTokenBackedSystemStatus({ cwd, ghBinary, authToken })
        : readCliBackedSystemStatus({ cwd, ghBinary }), options.runtime);
    cacheSystemStatus(cacheKey, status);
    return structuredClone(status);
}

export function peekCachedSystemStatus(options: SystemStatusReadOptions = {}): SystemState {
    const authToken = options.authToken?.trim();
    const cwd = options.cwd?.trim() || process.cwd();
    const ghBinary = getOpenMissionGitHubCliBinary() ?? 'gh';
    const cacheKey = createSystemStatusCacheKey({
        cwd,
        ghBinary,
        ...(authToken ? { authToken } : {})
    });
    const cachedSystemStatus = cachedSystemStatusByKey.get(cacheKey);
    return structuredClone(withVolatileSystemStatus(cachedSystemStatus?.status ?? buildUnknownSystemStatus(), options.runtime));
}

function readCliBackedSystemStatus(input: { cwd: string; ghBinary: string }): SystemState {
    const authResult = spawnSync(input.ghBinary, ['auth', 'status'], {
        cwd: input.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GITHUB_CLI_TIMEOUT_MS
    });
    const detail = resolveGitHubCliFailureDetail(authResult, input.ghBinary)
        ?? resolveGitHubCliDetail(authResult.stdout ?? '', authResult.stderr ?? '');
    const authenticated = authResult.status === 0;
    const identity = authenticated
        ? readGitHubIdentity({ cwd: input.cwd, ghBinary: input.ghBinary })
        : undefined;
    const user = identity?.user;
    const email = identity?.email;
    const avatarUrl = identity?.avatarUrl;

    return systemStateSchema.parse({
        sampledAt: new Date().toISOString(),
        github: {
            cliAvailable: !(authResult.error && 'code' in authResult.error && authResult.error.code === 'ENOENT'),
            authenticated,
            ...(user ? { user } : {}),
            ...(email ? { email } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(detail
                ? { detail }
                : authResult.error && 'code' in authResult.error && authResult.error.code === 'ENOENT'
                    ? { detail: `GitHub CLI is not installed at '${input.ghBinary}'.` }
                    : authenticated
                        ? { detail: 'GitHub CLI authenticated.' }
                        : { detail: 'GitHub CLI authentication is required.' })
        },
        config: buildSystemConfig(),
        ...buildDefaultVolatileSystemStatus()
    });
}

function readTokenBackedSystemStatus(input: {
    cwd: string;
    ghBinary: string;
    authToken: string;
}): SystemState {
    const authEnv = buildGitHubAuthEnv(input.authToken);
    const authResult = spawnSync(input.ghBinary, ['api', 'user'], {
        cwd: input.cwd,
        encoding: 'utf8',
        env: authEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GITHUB_CLI_TIMEOUT_MS
    });
    const detail = authResult.status === 0
        ? undefined
        : resolveGitHubCliFailureDetail(authResult, input.ghBinary)
        ?? resolveGitHubCliDetail(authResult.stdout ?? '', authResult.stderr ?? '');
    const cliAvailable = !(authResult.error && 'code' in authResult.error && authResult.error.code === 'ENOENT');
    const identity = authResult.status === 0
        ? readGitHubIdentity({
            cwd: input.cwd,
            ghBinary: input.ghBinary,
            env: authEnv,
            userOutput: authResult.stdout ?? ''
        })
        : undefined;
    const user = authResult.status === 0 ? identity?.user : undefined;
    const email = identity?.email;
    const avatarUrl = identity?.avatarUrl;

    return systemStateSchema.parse({
        sampledAt: new Date().toISOString(),
        github: {
            cliAvailable,
            authenticated: authResult.status === 0,
            ...(user ? { user } : {}),
            ...(email ? { email } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(detail
                ? { detail }
                : !cliAvailable
                    ? { detail: `GitHub CLI is not installed at '${input.ghBinary}'.` }
                    : authResult.status === 0
                        ? { detail: `GitHub token authenticated${user ? ` as ${user}` : ''}.` }
                        : { detail: 'GitHub token is invalid or missing required scopes.' })
        },
        config: buildSystemConfig(),
        ...buildDefaultVolatileSystemStatus()
    });
}

function readGitHubIdentity(input: {
    cwd: string;
    ghBinary: string;
    env?: NodeJS.ProcessEnv;
    userOutput?: string;
}): { user?: string; email?: string; avatarUrl?: string } {
    const userOutput = input.userOutput ?? spawnSync(input.ghBinary, ['api', 'user'], {
        cwd: input.cwd,
        encoding: 'utf8',
        env: input.env,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GITHUB_CLI_TIMEOUT_MS
    }).stdout ?? '';
    const parsedUser = parseGitHubUserResponse(userOutput);
    const user = parsedUser?.login;
    const directEmail = normalizeOptionalString(parsedUser?.email);
    const avatarUrl = normalizeOptionalString(parsedUser?.avatar_url);
    if (directEmail) {
        return {
            ...(user ? { user } : {}),
            email: directEmail,
            ...(avatarUrl ? { avatarUrl } : {})
        };
    }

    const emailResult = spawnSync(input.ghBinary, ['api', 'user/emails'], {
        cwd: input.cwd,
        encoding: 'utf8',
        env: input.env,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GITHUB_CLI_TIMEOUT_MS
    });
    const email = resolvePrimaryGitHubEmail(emailResult.stdout ?? '');
    return {
        ...(user ? { user } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(email ? { email } : {})
    };
}

function buildGitHubAuthEnv(authToken: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        GH_TOKEN: authToken,
        GITHUB_TOKEN: authToken
    };
}

function createSystemStatusCacheKey(input: {
    cwd: string;
    ghBinary: string;
    authToken?: string;
}): string {
    return `${input.cwd}\u0000${input.ghBinary}\u0000${process.env['PATH'] ?? ''}\u0000${input.authToken ?? ''}`;
}

function cacheSystemStatus(cacheKey: string, status: SystemState): void {
    cachedSystemStatusByKey.set(cacheKey, {
        checkedAt: Date.now(),
        status
    });
}

function buildUnknownSystemStatus(): SystemState {
    return systemStateSchema.parse({
        sampledAt: new Date().toISOString(),
        github: {
            cliAvailable: false,
            authenticated: false,
            detail: 'GitHub status has not been checked by the daemon yet.'
        },
        config: buildSystemConfig(),
        ...buildDefaultVolatileSystemStatus()
    });
}

function withVolatileSystemStatus(status: SystemState, runtimeOptions: SystemStatusRuntimeOptions | undefined): SystemState {
    return systemStateSchema.parse({
        ...status,
        sampledAt: new Date().toISOString(),
        ...buildVolatileSystemStatus(runtimeOptions)
    });
}

function buildDefaultVolatileSystemStatus() {
    return buildVolatileSystemStatus(undefined);
}

function buildVolatileSystemStatus(runtimeOptions: SystemStatusRuntimeOptions | undefined): Pick<SystemState, 'daemon' | 'host' | 'runtime' | 'diagnostics'> {
    const sampledAt = new Date().toISOString();
    const daemonStartedAt = runtimeOptions?.daemon?.startedAt ?? sampledAt;
    return {
        daemon: {
            pid: runtimeOptions?.daemon?.pid ?? process.pid,
            startedAt: daemonStartedAt,
            uptimeMs: Math.max(0, Date.now() - Date.parse(daemonStartedAt)),
            protocolVersion: runtimeOptions?.daemon?.protocolVersion ?? PROTOCOL_VERSION,
            runtimePath: runtimeOptions?.daemon?.runtimePath ?? getDaemonRuntimePath(),
            ...(runtimeOptions?.daemon?.socketPath ? { socketPath: runtimeOptions.daemon.socketPath } : {})
        },
        host: buildHostSystemState(),
        runtime: buildRuntimeSystemState(runtimeOptions),
        diagnostics: {
            sampledAt,
            statusCacheTtlMs: SYSTEM_STATUS_CACHE_TTL_MS
        }
    };
}

function buildHostSystemState(): SystemState['host'] {
    const memoryUsage = process.memoryUsage();
    return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        loadAverage: os.loadavg(),
        memory: {
            rss: memoryUsage.rss,
            heapTotal: memoryUsage.heapTotal,
            heapUsed: memoryUsage.heapUsed,
            external: memoryUsage.external,
            systemTotal: os.totalmem(),
            systemFree: os.freemem()
        }
    };
}

function buildRuntimeSystemState(runtimeOptions: SystemStatusRuntimeOptions | undefined): RuntimeSystemState {
    const runtimeSupervision = runtimeOptions?.runtimeSupervision;
    const leases = runtimeSupervision?.leases ?? [];
    const activeLeases = leases.filter((lease) => lease.state === 'active');
    const activeAgentExecutionSummary = runtimeOptions?.agentExecutionSummary;
    const activeAgentExecutions = activeAgentExecutionSummary?.activeAgentExecutionCount ?? runtimeOptions?.activeAgentExecutionCount ?? 0;
    const activeAgentExecutionOwners = runtimeSupervision?.owners.filter(isAgentExecutionOwner) ?? [];
    const activeAgentExecutionOwnerKeys = new Set(
        activeAgentExecutionOwners.map((owner) => createAgentExecutionOwnerKey(owner.ownerId, owner.agentExecutionId))
    );
    const activeAgentExecutionRuntimeLeaseOwnerKeys = new Set(
        activeLeases
            .filter(hasAgentExecutionOwner)
            .map((lease) => createAgentExecutionOwnerKey(lease.owner.ownerId, lease.owner.agentExecutionId))
    );
    const runtimeLeasesWithoutAgentExecution = activeLeases.filter((lease) => {
        if (lease.owner.kind !== 'agent-execution') {
            return false;
        }
        return !activeAgentExecutionOwnerKeys.has(createAgentExecutionOwnerKey(lease.owner.ownerId, lease.owner.agentExecutionId));
    }).length;
    const agentExecutionsWithoutRuntimeLease = activeAgentExecutionSummary?.executionsWithoutRuntimeLeaseCount
        ?? Math.max(0, activeAgentExecutions - activeAgentExecutionRuntimeLeaseOwnerKeys.size);
    const terminalLeasesWithoutOwner = activeLeases.filter((lease) => lease.kind === 'terminal' && lease.owner.kind !== 'agent-execution').length;
    const detachedAgentExecutions = activeAgentExecutionSummary?.detachedAgentExecutionCount
        ?? Math.max(agentExecutionsWithoutRuntimeLease, Math.max(0, activeAgentExecutions - activeAgentExecutionOwners.length));
    const protocolIncompatibleAgentExecutions = activeAgentExecutionSummary?.protocolIncompatibleAgentExecutionCount
        ?? activeLeases.filter((lease) => lease.owner.kind === 'agent-execution' && lease.metadata?.['runtimeHealth'] === 'protocol-incompatible').length;
    const degradedAgentExecutions = activeAgentExecutionSummary?.degradedAgentExecutionCount
        ?? Math.max(detachedAgentExecutions, protocolIncompatibleAgentExecutions);
    return {
        loadedRepositories: runtimeOptions?.loadedRepositoryCount ?? 0,
        loadedMissions: runtimeOptions?.loadedMissionCount ?? 0,
        activeAgentExecutions,
        attachedAgentExecutions: activeAgentExecutionSummary?.attachedAgentExecutionCount ?? Math.max(0, activeAgentExecutions - detachedAgentExecutions),
        detachedAgentExecutions,
        degradedAgentExecutions,
        protocolIncompatibleAgentExecutions,
        agentExecutionsWithoutRuntimeLease,
        runtimeLeasesWithoutAgentExecution,
        terminalLeasesWithoutOwner,
        reconciliationRequired: leases.some((lease) => lease.state === 'orphaned')
            || detachedAgentExecutions > 0
            || runtimeLeasesWithoutAgentExecution > 0
            || terminalLeasesWithoutOwner > 0
            || protocolIncompatibleAgentExecutions > 0,
        supervisionOwners: runtimeSupervision?.owners.length ?? 0,
        supervisionRelationships: runtimeSupervision?.relationships.length ?? 0,
        runtimeLeases: leases.length,
        activeRuntimeLeases: activeLeases.length,
        activeTerminalLeases: activeLeases.filter((lease) => lease.kind === 'terminal').length,
        orphanedRuntimeLeases: leases.filter((lease) => lease.state === 'orphaned').length,
        ...(runtimeOptions?.surreal ? { surreal: runtimeOptions.surreal } : {})
    };
}

function createAgentExecutionOwnerKey(ownerId: string, agentExecutionId: string): string {
    return `${ownerId}\u0000${agentExecutionId}`;
}

function isAgentExecutionOwner(owner: DaemonRuntimeOwnerReference): owner is Extract<DaemonRuntimeOwnerReference, { kind: 'agent-execution' }> {
    return owner.kind === 'agent-execution';
}

function hasAgentExecutionOwner(lease: DaemonRuntimeLease): lease is DaemonRuntimeLease & {
    owner: Extract<DaemonRuntimeOwnerReference, { kind: 'agent-execution' }>;
} {
    return isAgentExecutionOwner(lease.owner);
}

function buildSystemConfig(): SystemConfig {
    const openMissionConfig = readOpenMissionConfig() ?? getDefaultOpenMissionConfig();
    return systemConfigSchema.parse({
        repositoriesRoot: resolveRepositoriesRoot(openMissionConfig),
        defaultAgentAdapter: openMissionConfig.defaultAgentAdapter,
        enabledAgentAdapters: openMissionConfig.enabledAgentAdapters,
        ...(openMissionConfig.defaultAgentMode ? { defaultAgentMode: openMissionConfig.defaultAgentMode } : {}),
        ...(openMissionConfig.defaultModel ? { defaultModel: openMissionConfig.defaultModel } : {}),
        ...(openMissionConfig.defaultReasoningEffort ? { defaultReasoningEffort: openMissionConfig.defaultReasoningEffort } : {})
    });
}

function resolveGitHubCliFailureDetail(
    result: ReturnType<typeof spawnSync>,
    ghBinary: string
): string | undefined {
    if (!result.error || !("code" in result.error)) {
        return undefined;
    }

    if (result.error.code === 'ENOENT') {
        return `GitHub CLI is not installed at '${ghBinary}'.`;
    }

    if (result.error.code === 'ETIMEDOUT') {
        return `GitHub CLI timed out after ${String(GITHUB_CLI_TIMEOUT_MS)}ms.`;
    }

    return undefined;
}

function resolveGitHubCliDetail(stdout: string, stderr: string): string | undefined {
    const normalizedStderr = stderr
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    if (normalizedStderr) {
        return normalizedStderr.replace(/^gh:\s*/u, '').trim();
    }

    const trimmedStdout = stdout.trim();
    if (!trimmedStdout) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(trimmedStdout) as { message?: unknown };
        const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
        if (message) {
            return message;
        }
    } catch {
        // ignore JSON parse errors and fall back to the first non-empty line
    }

    return trimmedStdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
}

function parseGitHubUserResponse(output: string): { login?: string; email?: string; avatar_url?: string } | undefined {
    const normalizedOutput = output.trim();
    if (!normalizedOutput) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(normalizedOutput) as {
            login?: unknown;
            email?: unknown;
            avatar_url?: unknown;
        };
        const login = normalizeOptionalString(parsed.login);
        const email = normalizeOptionalString(parsed.email);
        const avatarUrl = normalizeOptionalString(parsed.avatar_url);
        return {
            ...(login ? { login } : {}),
            ...(email ? { email } : {}),
            ...(avatarUrl ? { avatar_url: avatarUrl } : {})
        };
    } catch {
        return undefined;
    }
}

function resolvePrimaryGitHubEmail(output: string): string | undefined {
    const normalizedOutput = output.trim();
    if (!normalizedOutput) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(normalizedOutput) as Array<{
            email?: unknown;
            primary?: unknown;
            verified?: unknown;
            visibility?: unknown;
        }>;
        const preferred = parsed.find((entry) => entry.primary === true && entry.verified === true)
            ?? parsed.find((entry) => entry.primary === true)
            ?? parsed.find((entry) => entry.verified === true)
            ?? parsed.find((entry) => normalizeOptionalString(entry.visibility) === 'public')
            ?? parsed[0];
        return normalizeOptionalString(preferred?.email);
    } catch {
        return undefined;
    }
}

function normalizeOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}