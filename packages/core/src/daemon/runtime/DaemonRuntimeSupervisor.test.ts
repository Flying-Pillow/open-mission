import { describe, expect, it, vi } from 'vitest';
import { DaemonRuntimeSupervisor } from './DaemonRuntimeSupervisor.js';

describe('DaemonRuntimeSupervisor', () => {
    it('owns Open Mission MCP server lifecycle when configured', async () => {
        const openMissionMcpServer = {
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined)
        };
        const supervisor = new DaemonRuntimeSupervisor({
            daemonProcessId: 4242,
            startedAt: '2026-05-10T00:00:00.000Z',
            terminalRegistry: {
                readRuntimeSupervisionSnapshot: () => ({
                    daemonProcessId: 4242,
                    startedAt: '2026-05-10T00:00:00.000Z',
                    owners: [],
                    relationships: [],
                    leases: []
                }),
                dispose: vi.fn().mockResolvedValue(undefined)
            } as never,
            openMissionMcpServer: openMissionMcpServer as never
        });

        await supervisor.start();
        await supervisor.releaseAll();

        expect(openMissionMcpServer.start).toHaveBeenCalledTimes(1);
        expect(openMissionMcpServer.stop).toHaveBeenCalledTimes(1);
    });

    it('merges active AgentExecution owners into the runtime supervision graph', () => {
        const supervisor = new DaemonRuntimeSupervisor({
            daemonProcessId: 4242,
            startedAt: '2026-05-10T00:00:00.000Z',
            terminalRegistry: {
                readRuntimeSupervisionSnapshot: () => ({
                    daemonProcessId: 4242,
                    startedAt: '2026-05-10T00:00:00.000Z',
                    owners: [],
                    relationships: [],
                    leases: []
                }),
                dispose: vi.fn()
            } as never,
            agentExecutionRegistry: {
                readRuntimeSummary: () => ({
                    activeAgentExecutionCount: 1,
                    attachedAgentExecutionCount: 0,
                    detachedAgentExecutionCount: 1,
                    degradedAgentExecutionCount: 1,
                    protocolIncompatibleAgentExecutionCount: 1,
                    executionsWithoutRuntimeLeaseCount: 1,
                    executions: [{
                        ownerId: 'mission-123',
                        agentId: 'copilot-cli',
                        agentExecutionId: 'execution-1',
                        scope: { kind: 'mission', missionId: 'mission-123' },
                        status: 'running',
                        transportState: {
                            selected: 'stdout-marker',
                            degraded: true,
                            health: 'protocol-incompatible',
                            leaseAttached: false
                        },
                        hasRuntimeLease: false,
                        attached: false,
                        degraded: true,
                        protocolIncompatible: true
                    }]
                })
            } as never
        });

        const snapshot = supervisor.readSnapshot();

        expect(snapshot.owners).toContainEqual({
            kind: 'agent-execution',
            ownerId: 'mission-123',
            agentExecutionId: 'execution-1',
            scope: { kind: 'mission', missionId: 'mission-123' }
        });
        expect(snapshot.relationships).toContainEqual({
            parent: { kind: 'mission', missionId: 'mission-123' },
            child: {
                kind: 'agent-execution',
                ownerId: 'mission-123',
                agentExecutionId: 'execution-1',
                scope: { kind: 'mission', missionId: 'mission-123' }
            },
            relationship: 'owns-agent-execution'
        });
    });
});