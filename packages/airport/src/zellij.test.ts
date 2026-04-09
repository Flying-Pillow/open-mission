import { describe, expect, it } from 'vitest';
import type { AirportState } from './types.js';
import { ZellijSubstrateController, type ZellijExecutor } from './zellij.js';

describe('ZellijSubstrateController', () => {
    it('does not refocus the pilot target again when the binding is unchanged', async () => {
        const calls: string[][] = [];
        const executor: ZellijExecutor = async (args) => {
            calls.push(args);
            if (args.includes('list-panes')) {
                return {
                    stdout: JSON.stringify([
                        { id: 1, title: 'MISSION', is_plugin: false, is_focused: true },
                        { id: 2, title: 'PILOT', is_plugin: false, is_focused: false },
                        { id: 3, title: 'session-1', is_plugin: false, is_focused: false }
                    ]),
                    stderr: ''
                };
            }
            return { stdout: '', stderr: '' };
        };

        const controller = new ZellijSubstrateController({
            sessionName: 'mission-mission',
            executor
        });
        const airportState = createAirportState({
            pilot: { targetKind: 'agentSession', targetId: 'session-1', mode: 'control' }
        });

        await controller.reconcile(airportState);
        await controller.reconcile(airportState);

        expect(calls.filter((args) => args.includes('focus-pane-id'))).toEqual([
            ['--session', 'mission-mission', 'action', 'focus-pane-id', 'terminal_3'],
            ['--session', 'mission-mission', 'action', 'focus-pane-id', 'terminal_1']
        ]);
    });

    it('does not focus the pilot host pane while the pilot gate is idle', async () => {
        const calls: string[][] = [];
        const executor: ZellijExecutor = async (args) => {
            calls.push(args);
            if (args.includes('list-panes')) {
                return {
                    stdout: JSON.stringify([
                        { id: 1, title: 'MISSION', is_plugin: false, is_focused: true },
                        { id: 2, title: 'PILOT', is_plugin: false, is_focused: false }
                    ]),
                    stderr: ''
                };
            }
            return { stdout: '', stderr: '' };
        };

        const controller = new ZellijSubstrateController({
            sessionName: 'mission-mission',
            executor
        });

        await controller.reconcile(createAirportState());

        expect(calls.filter((args) => args.includes('focus-pane-id'))).toEqual([]);
    });
});

function createAirportState(overrides: Partial<AirportState['gates']> = {}): AirportState {
    return {
        airportId: 'airport:test',
        repositoryId: 'repo',
        repositoryRootPath: '/tmp/repo',
        gates: {
            dashboard: { targetKind: 'repository', targetId: 'repo', mode: 'control' },
            editor: { targetKind: 'repository', targetId: 'repo', mode: 'view' },
            pilot: { targetKind: 'empty' },
            ...overrides
        },
        focus: {},
        clients: {},
        substrate: {
            kind: 'zellij',
            sessionName: 'mission-mission',
            layoutIntent: 'mission-control-v1',
            attached: false,
            panesByGate: {}
        }
    };
}