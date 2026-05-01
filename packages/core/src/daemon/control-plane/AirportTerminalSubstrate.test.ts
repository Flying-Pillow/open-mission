import { describe, expect, it } from 'vitest';
import type { AirportState } from '../../airport/types.js';
import {
    planAirportSubstrateEffects,
    ClientReportedSubstrateController
} from './AirportTerminalSubstrate.js';

describe('ClientReportedSubstrateController', () => {
    it('observes pane claims and focus reported by connected clients', async () => {
        const controller = new ClientReportedSubstrateController({
            sessionName: 'mission-mission'
        });
        const airportState = createAirportState({}, {
            tower: { terminalPaneId: 0, expected: true, exists: false, title: 'TOWER' },
            briefingRoom: { terminalPaneId: 2, expected: true, exists: false, title: 'BRIEFING ROOM' }
        });
        airportState.clients = {
            tower: {
                clientId: 'tower',
                connected: true,
                label: 'tower',
                claimedPaneId: 'tower',
                focusedPaneId: 'briefingRoom',
                connectedAt: '2026-01-01T00:00:00.000Z',
                lastSeenAt: '2026-01-01T00:00:01.000Z'
            }
        };

        const observed = await controller.observe(airportState);

        expect(observed.panes.tower).toMatchObject({
            terminalPaneId: 0,
            exists: true,
            title: 'TOWER'
        });
        expect(observed.panes.briefingRoom).toMatchObject({
            terminalPaneId: 2,
            exists: false,
            title: 'BRIEFING ROOM'
        });
        expect(observed.observedFocusedTerminalPaneId).toBe(2);
    });

    it('does not apply focus effects when panes are detached', async () => {
        const controller = new ClientReportedSubstrateController({
            sessionName: 'mission-mission'
        });
        const observed = await controller.observe(createAirportState({
            runway: { targetKind: 'agentSession', targetId: 'session-1', mode: 'control' }
        }, {
            tower: { terminalPaneId: 1, expected: true, exists: true, title: 'TOWER' },
            briefingRoom: { terminalPaneId: 2, expected: true, exists: true, title: 'BRIEFING ROOM' },
            runway: { terminalPaneId: 3, expected: true, exists: true, title: 'RUNWAY' }
        }));
        const airportState = createAirportState();
        airportState.focus.intentPaneId = 'briefingRoom';
        airportState.substrate = observed;

        const applied = await controller.applyEffects(planAirportSubstrateEffects(airportState));

        expect(applied.observedFocusedTerminalPaneId).toBeUndefined();
    });

    it('keeps detached panes stable when there are no connected clients', async () => {
        const controller = new ClientReportedSubstrateController({
            sessionName: 'mission-mission'
        });
        const airportState = createAirportState();
        airportState.substrate = {
            ...airportState.substrate,
            panes: {
                briefingRoom: { terminalPaneId: 2, expected: true, exists: true, title: 'BRIEFING ROOM' }
            }
        };

        const observed = await controller.observe(airportState);

        expect(observed.attached).toBe(false);
        expect(observed.panes.briefingRoom).toMatchObject({ exists: false, terminalPaneId: 2 });
    });

    it('does not plan runway substrate effects from runway bindings', () => {
        const airportState = createAirportState({
            runway: { targetKind: 'agentSession', targetId: 'session-1', mode: 'control' }
        });

        expect(planAirportSubstrateEffects(airportState)).toEqual([]);
    });

    it('reports a detached substrate when no clients are connected', async () => {
        const controller = new ClientReportedSubstrateController({
            sessionName: 'mission-mission'
        });

        const observed = await controller.observe(createAirportState());

        expect(observed.attached).toBe(false);
        expect(observed.panes.tower).toMatchObject({ exists: false, expected: true, title: 'TOWER' });
    });
});

function createAirportState(overrides: Partial<AirportState['panes']> = {}, panes: AirportState['substrate']['panes'] = {}): AirportState {
    const defaultPanes: AirportState['defaultPanes'] = {
        tower: { targetKind: 'repository', targetId: 'repo', mode: 'control' },
        briefingRoom: { targetKind: 'repository', targetId: 'repo', mode: 'view' },
        runway: { targetKind: 'empty' }
    };
    return {
        airportId: 'airport:test',
        repositoryId: 'repo',
        repositoryRootPath: '/tmp/repo',
        defaultPanes,
        paneOverrides: {},
        panes: {
            ...defaultPanes,
            ...overrides
        },
        focus: {},
        clients: {},
        substrate: {
            kind: 'terminal-manager',
            sessionName: 'mission-mission',
            layoutIntent: 'mission-control-v1',
            attached: false,
            panes
        }
    };
}
