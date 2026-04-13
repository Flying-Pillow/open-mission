import { describe, expect, it } from 'vitest';
import { AirportControl } from './AirportControl.js';
import type { AirportSubstrateState } from './types.js';

describe('AirportControl', () => {
	it('reconciles observed focus from substrate pane observations', () => {
		const control = new AirportControl({
			airportId: 'airport:test',
			repositoryId: 'repo',
			repositoryRootPath: '/tmp/repo',
			terminalSessionName: 'mission-control-repo-test'
		});

		control.connectClient({
			clientId: 'tower',
			paneId: 'tower',
			terminalPaneId: 1
		});

		control.observeClient({
			clientId: 'tower',
			focusedPaneId: 'tower'
		});

		const substrate: AirportSubstrateState = {
			kind: 'terminal-manager',
			sessionName: 'mission-control',
			layoutIntent: 'mission-control-v1',
			attached: true,
			observedFocusedTerminalPaneId: 2,
			panes: {
				tower: { terminalPaneId: 1, expected: true, exists: true, title: 'TOWER' },
				briefingRoom: { terminalPaneId: 2, expected: true, exists: true, title: 'BRIEFING ROOM' }
			}
		};

		control.observeSubstrate(substrate);

		expect(control.getState().focus).toMatchObject({ observedPaneId: 'briefingRoom' });
	});
});