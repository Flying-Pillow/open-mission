// /packages/core/src/daemon/control-plane/AirportProjectionService.test.ts: Verifies that tower projections include GitHub auth status for surface rendering.
import { describe, expect, it } from 'vitest';
import type { AirportState } from '../../airport/types.js';
import type { SystemState } from '../../schemas/SystemState.js';
import type { ContextGraph } from '../../types.js';
import { deriveSystemAirportProjections } from './AirportProjectionService.js';

describe('deriveSystemAirportProjections', () => {
    it('maps GitHub auth identity into the tower projection', () => {
        const domain: ContextGraph = {
            selection: {
                repositoryId: 'repo-1'
            },
            repositories: {
                'repo-1': {
                    repositoryId: 'repo-1',
                    rootPath: '/workspace/repo-1',
                    displayLabel: 'Mission Repo',
                    missionIds: []
                }
            },
            missions: {},
            tasks: {},
            artifacts: {},
            agentSessions: {}
        };
        const airportState: AirportState = {
            airportId: 'airport-1',
            repositoryId: 'repo-1',
            repositoryRootPath: '/workspace/repo-1',
            defaultPanes: {
                tower: { targetKind: 'repository', targetId: 'repo-1', mode: 'control' },
                briefingRoom: { targetKind: 'repository', targetId: 'repo-1', mode: 'view' },
                runway: { targetKind: 'empty' }
            },
            paneOverrides: {},
            panes: {
                tower: { targetKind: 'repository', targetId: 'repo-1', mode: 'control' },
                briefingRoom: { targetKind: 'repository', targetId: 'repo-1', mode: 'view' },
                runway: { targetKind: 'empty' }
            },
            focus: {},
            clients: {},
            substrate: {
                kind: 'terminal-manager',
                sessionName: 'mission-airport',
                panes: {},
                layoutIntent: 'mission-control-v1',
                attached: false
            }
        };
        const systemStatus: SystemState = {
            github: {
                cliAvailable: true,
                authenticated: true,
                user: 'mission-test',
                detail: 'GitHub token authenticated as mission-test.'
            }
        };

        const projections = deriveSystemAirportProjections(domain, airportState, systemStatus);

        expect(projections.tower.github).toEqual({
            cliAvailable: true,
            authenticated: true,
            user: 'mission-test',
            detail: 'GitHub token authenticated as mission-test.'
        });
        expect(projections.tower.repositoryLabel).toBe('Mission Repo');
    });

    it('defaults tower GitHub status when system status is unavailable', () => {
        const domain: ContextGraph = {
            selection: {},
            repositories: {},
            missions: {},
            tasks: {},
            artifacts: {},
            agentSessions: {}
        };
        const airportState: AirportState = {
            airportId: 'airport-1',
            repositoryId: 'repo-1',
            defaultPanes: {
                tower: { targetKind: 'repository', targetId: 'repo-1', mode: 'control' },
                briefingRoom: { targetKind: 'repository', targetId: 'repo-1', mode: 'view' },
                runway: { targetKind: 'empty' }
            },
            paneOverrides: {},
            panes: {
                tower: { targetKind: 'repository', targetId: 'repo-1', mode: 'control' },
                briefingRoom: { targetKind: 'repository', targetId: 'repo-1', mode: 'view' },
                runway: { targetKind: 'empty' }
            },
            focus: {},
            clients: {},
            substrate: {
                kind: 'terminal-manager',
                sessionName: 'mission-airport',
                panes: {},
                layoutIntent: 'mission-control-v1',
                attached: false
            }
        };

        const projections = deriveSystemAirportProjections(domain, airportState);

        expect(projections.tower.github).toEqual({
            cliAvailable: false,
            authenticated: false
        });
    });
});