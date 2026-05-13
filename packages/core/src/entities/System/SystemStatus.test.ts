import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeOpenMissionConfig } from '../../settings/OpenMissionInstall.js';

describe('SystemStatus', () => {
    afterEach(async () => {
        vi.resetModules();
        vi.unstubAllEnvs();
    });

    it('falls back to gh on PATH when Mission config has no ghBinary', async () => {
        const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-status-'));
        const configHome = path.join(sandboxRoot, 'config-home');
        const binDirectory = path.join(sandboxRoot, 'bin');
        await fs.mkdir(binDirectory, { recursive: true });
        await fs.writeFile(
            path.join(binDirectory, 'gh'),
            `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo "authentication required" >&2
  exit 1
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  echo "fallback-user"
  exit 0
fi
exit 1
`,
            { mode: 0o755 }
        );

        stubOpenMissionConfigHome(configHome);
        vi.stubEnv('PATH', `${binDirectory}:${process.env['PATH'] ?? ''}`);

        const { readSystemStatus } = await import('./SystemStatus.js');
        const status = readSystemStatus({ cwd: sandboxRoot });

        expect(status.github.cliAvailable).toBe(true);
        expect(status.github.authenticated).toBe(false);
        expect(status.github.detail).toBe('authentication required');
        expect(status.daemon.pid).toBe(process.pid);
        expect(status.host.nodeVersion).toBe(process.version);
        expect(status.runtime.activeTerminalLeases).toBe(0);

        await fs.rm(sandboxRoot, { recursive: true, force: true });
    });

    it('includes system agent settings from Mission config', async () => {
        const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-status-'));
        const configHome = path.join(sandboxRoot, 'config-home');
        const emptyPathDirectory = path.join(sandboxRoot, 'empty-path');
        await fs.mkdir(emptyPathDirectory, { recursive: true });

        stubOpenMissionConfigHome(configHome);
        vi.stubEnv('PATH', emptyPathDirectory);
        await writeOpenMissionConfig({
            repositoriesRoot: '/tmp/repositories',
            defaultAgentAdapter: 'copilot',
            enabledAgentAdapters: ['copilot', 'codex']
        });

        const { readSystemStatus } = await import('./SystemStatus.js');
        const status = readSystemStatus({ cwd: sandboxRoot });

        expect(status.config).toEqual({
            repositoriesRoot: '/tmp/repositories',
            defaultAgentAdapter: 'copilot',
            enabledAgentAdapters: ['copilot', 'codex']
        });

        await fs.rm(sandboxRoot, { recursive: true, force: true });
    });

    it('reports gh as missing when Mission config has no ghBinary and gh is not on PATH', async () => {
        const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-status-'));
        const configHome = path.join(sandboxRoot, 'config-home');
        const emptyPathDirectory = path.join(sandboxRoot, 'empty-path');
        await fs.mkdir(emptyPathDirectory, { recursive: true });

        stubOpenMissionConfigHome(configHome);
        vi.stubEnv('PATH', emptyPathDirectory);

        const { readSystemStatus } = await import('./SystemStatus.js');
        const status = readSystemStatus({ cwd: sandboxRoot });

        expect(status.github.cliAvailable).toBe(false);
        expect(status.github.authenticated).toBe(false);
        expect(status.github.detail).toBe("GitHub CLI is not installed at 'gh'.");

        await fs.rm(sandboxRoot, { recursive: true, force: true });
    });

    it('invalidates cached status when PATH changes', async () => {
        const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-status-'));
        const configHome = path.join(sandboxRoot, 'config-home');
        const missingPathDirectory = path.join(sandboxRoot, 'missing-path');
        const binDirectory = path.join(sandboxRoot, 'bin');
        await fs.mkdir(missingPathDirectory, { recursive: true });
        await fs.mkdir(binDirectory, { recursive: true });
        await fs.writeFile(
            path.join(binDirectory, 'gh'),
            `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo "Logged in to github.com as mission-test"
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  echo '{"login":"mission-test","email":null}'
  exit 0
fi
exit 1
`,
            { mode: 0o755 }
        );

        stubOpenMissionConfigHome(configHome);
        vi.stubEnv('PATH', missingPathDirectory);

        const { readSystemStatus } = await import('./SystemStatus.js');
        const missing = readSystemStatus({ cwd: sandboxRoot });
        expect(missing.github.cliAvailable).toBe(false);

        vi.stubEnv('PATH', `${binDirectory}:${missingPathDirectory}`);
        const available = readSystemStatus({ cwd: sandboxRoot });
        expect(available.github.cliAvailable).toBe(true);
        expect(available.github.authenticated).toBe(true);
        expect(available.github.user).toBe('mission-test');

        await fs.rm(sandboxRoot, { recursive: true, force: true });
    });

    it('resolves GitHub email from token-backed identity when available', async () => {
        const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-status-'));
        const configHome = path.join(sandboxRoot, 'config-home');
        const binDirectory = path.join(sandboxRoot, 'bin');
        await fs.mkdir(binDirectory, { recursive: true });
        await fs.writeFile(
            path.join(binDirectory, 'gh'),
            `#!/bin/sh
if [ "$1" = "api" ] && [ "$2" = "user" ] && [ "$3" = "--jq" ] && [ "$4" = ".login" ]; then
  echo "mission-test"
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  echo '{"login":"mission-test","email":null}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user/emails" ]; then
  echo '[{"email":"mission@example.com","primary":true,"verified":true}]'
  exit 0
fi
exit 1
`,
            { mode: 0o755 }
        );

        stubOpenMissionConfigHome(configHome);
        vi.stubEnv('PATH', `${binDirectory}:${process.env['PATH'] ?? ''}`);

        const { readSystemStatus } = await import('./SystemStatus.js');
        const status = readSystemStatus({ cwd: sandboxRoot, authToken: 'ghp_test_token' });

        expect(status.github.authenticated).toBe(true);
        expect(status.github.user).toBe('mission-test');
        expect(status.github.email).toBe('mission@example.com');

        await fs.rm(sandboxRoot, { recursive: true, force: true });
    });

    it('includes daemon runtime supervision counts when provided', async () => {
        const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-status-'));
        const configHome = path.join(sandboxRoot, 'config-home');
        const emptyPathDirectory = path.join(sandboxRoot, 'empty-path');
        await fs.mkdir(emptyPathDirectory, { recursive: true });

        stubOpenMissionConfigHome(configHome);
        vi.stubEnv('PATH', emptyPathDirectory);

        const { readSystemStatus } = await import('./SystemStatus.js');
        const status = readSystemStatus({
            cwd: sandboxRoot,
            runtime: {
                daemon: {
                    pid: 4242,
                    startedAt: '2026-05-10T00:00:00.000Z',
                    socketPath: '/tmp/mission/daemon.sock'
                },
                loadedRepositoryCount: 2,
                loadedMissionCount: 3,
                activeAgentExecutionCount: 4,
                runtimeSupervision: {
                    daemonProcessId: 4242,
                    startedAt: '2026-05-10T00:00:00.000Z',
                    owners: [{ kind: 'agent-execution', ownerId: 'mission-1', agentExecutionId: 'agent-1' }],
                    relationships: [{
                        parent: { kind: 'agent-execution', ownerId: 'mission-1', agentExecutionId: 'agent-1' },
                        child: { kind: 'runtime-lease', leaseId: 'terminal:one:pty' },
                        relationship: 'owns-runtime-lease'
                    }],
                    leases: [{
                        leaseId: 'terminal:one:pty',
                        kind: 'terminal',
                        owner: { kind: 'agent-execution', ownerId: 'mission-1', agentExecutionId: 'agent-1' },
                        acquiredAt: '2026-05-10T00:00:00.000Z',
                        state: 'active',
                        processId: 31415,
                        terminalName: 'one'
                    }]
                }
            }
        });

        expect(status.daemon.pid).toBe(4242);
        expect(status.runtime).toMatchObject({
            loadedRepositories: 2,
            loadedMissions: 3,
            activeAgentExecutions: 4,
            attachedAgentExecutions: 1,
            detachedAgentExecutions: 3,
            degradedAgentExecutions: 3,
            protocolIncompatibleAgentExecutions: 0,
            agentExecutionsWithoutRuntimeLease: 3,
            runtimeLeasesWithoutAgentExecution: 0,
            terminalLeasesWithoutOwner: 0,
            reconciliationRequired: true,
            supervisionOwners: 1,
            supervisionRelationships: 1,
            runtimeLeases: 1,
            activeRuntimeLeases: 1,
            activeTerminalLeases: 1,
            orphanedRuntimeLeases: 0
        });

        await fs.rm(sandboxRoot, { recursive: true, force: true });
    });

    it('reports protocol-incompatible agent executions as runtime degradation', async () => {
        const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-status-'));
        const configHome = path.join(sandboxRoot, 'config-home');
        const emptyPathDirectory = path.join(sandboxRoot, 'empty-path');
        await fs.mkdir(emptyPathDirectory, { recursive: true });

        stubOpenMissionConfigHome(configHome);
        vi.stubEnv('PATH', emptyPathDirectory);

        const { readSystemStatus } = await import('./SystemStatus.js');
        const status = readSystemStatus({
            cwd: sandboxRoot,
            runtime: {
                activeAgentExecutionCount: 1,
                runtimeSupervision: {
                    daemonProcessId: 4242,
                    startedAt: '2026-05-10T00:00:00.000Z',
                    owners: [{ kind: 'agent-execution', ownerId: 'mission-1', agentExecutionId: 'agent-1' }],
                    relationships: [],
                    leases: [{
                        leaseId: 'terminal:one:pty',
                        kind: 'terminal',
                        owner: { kind: 'agent-execution', ownerId: 'mission-1', agentExecutionId: 'agent-1' },
                        acquiredAt: '2026-05-10T00:00:00.000Z',
                        state: 'active',
                        metadata: { runtimeHealth: 'protocol-incompatible' }
                    }]
                }
            }
        });

        expect(status.runtime).toMatchObject({
            activeAgentExecutions: 1,
            attachedAgentExecutions: 1,
            detachedAgentExecutions: 0,
            degradedAgentExecutions: 1,
            protocolIncompatibleAgentExecutions: 1,
            reconciliationRequired: true
        });

        await fs.rm(sandboxRoot, { recursive: true, force: true });
    });

    it('prefers daemon-provided agent execution runtime summary when available', async () => {
        const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-system-status-'));
        const configHome = path.join(sandboxRoot, 'config-home');
        const emptyPathDirectory = path.join(sandboxRoot, 'empty-path');
        await fs.mkdir(emptyPathDirectory, { recursive: true });

        stubOpenMissionConfigHome(configHome);
        vi.stubEnv('PATH', emptyPathDirectory);

        const { readSystemStatus } = await import('./SystemStatus.js');
        const status = readSystemStatus({
            cwd: sandboxRoot,
            runtime: {
                activeAgentExecutionCount: 4,
                agentExecutionSummary: {
                    activeAgentExecutionCount: 4,
                    attachedAgentExecutionCount: 2,
                    detachedAgentExecutionCount: 2,
                    degradedAgentExecutionCount: 3,
                    protocolIncompatibleAgentExecutionCount: 1,
                    executionsWithoutRuntimeLeaseCount: 2,
                    executions: []
                },
                runtimeSupervision: {
                    daemonProcessId: 4242,
                    startedAt: '2026-05-10T00:00:00.000Z',
                    owners: [],
                    relationships: [],
                    leases: []
                }
            }
        });

        expect(status.runtime).toMatchObject({
            activeAgentExecutions: 4,
            attachedAgentExecutions: 2,
            detachedAgentExecutions: 2,
            degradedAgentExecutions: 3,
            protocolIncompatibleAgentExecutions: 1,
            agentExecutionsWithoutRuntimeLease: 2
        });

        await fs.rm(sandboxRoot, { recursive: true, force: true });
    });
});

function stubOpenMissionConfigHome(configHome: string): void {
    vi.stubEnv('XDG_CONFIG_HOME', configHome);
    vi.stubEnv('OPEN_MISSION_CONFIG_PATH', configHome);
}