import {
	resolveMissionWorkspaceContext
} from '@flying-pillow/mission-core';
import type { MissionWorkspaceContext } from '@flying-pillow/mission-core';
import type { AirportTerminalContext } from '../airportTerminalContext.js';

export function resolveTowerWorkspaceContext(context: AirportTerminalContext): MissionWorkspaceContext {
	return resolveMissionWorkspaceContext(context.workingDirectory, context.controlRoot);
}