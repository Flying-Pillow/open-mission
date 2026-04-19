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

	it('keeps explicit briefing-room intent when canonical defaults are reapplied', () => {
		const control = new AirportControl({
			airportId: 'airport:test',
			repositoryId: 'repo',
			repositoryRootPath: '/tmp/repo',
			terminalSessionName: 'mission-control-repo-test'
		});

		control.bindPane({
			paneId: 'briefingRoom',
			binding: {
				targetKind: 'artifact',
				targetId: 'repo:task:task-1',
				mode: 'view'
			}
		});

		control.applyDefaultBindings({
			tower: { targetKind: 'mission', targetId: 'mission-1', mode: 'control' },
			briefingRoom: { targetKind: 'mission', targetId: 'mission-1', mode: 'view' }
		});

		expect(control.getState().defaultPanes.briefingRoom).toMatchObject({
			targetKind: 'mission',
			targetId: 'mission-1',
			mode: 'view'
		});
		expect(control.getState().paneOverrides.briefingRoom).toMatchObject({
			targetKind: 'artifact',
			targetId: 'repo:task:task-1',
			mode: 'view'
		});
		expect(control.getState().panes.briefingRoom).toMatchObject({
			targetKind: 'artifact',
			targetId: 'repo:task:task-1',
			mode: 'view'
		});
	});

	it('drops redundant briefing-room overrides once defaults catch up', () => {
		const control = new AirportControl({
			airportId: 'airport:test',
			repositoryId: 'repo',
			repositoryRootPath: '/tmp/repo',
			terminalSessionName: 'mission-control-repo-test'
		});

		control.bindPane({
			paneId: 'briefingRoom',
			binding: {
				targetKind: 'artifact',
				targetId: 'repo:task:task-1',
				mode: 'view'
			}
		});

		control.applyDefaultBindings({
			briefingRoom: {
				targetKind: 'artifact',
				targetId: 'repo:task:task-1',
				mode: 'view'
			}
		});

		expect(control.getState().paneOverrides.briefingRoom).toBeUndefined();
		expect(control.getPersistedIntent().panes).toBeUndefined();
	});
});