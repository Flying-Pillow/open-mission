import type {
	MissionSelector,
	MissionSystemSnapshot,
	OperatorStatus,
} from '@flying-pillow/mission-core';
import type { FocusArea } from './tower/components/types.js';
import type { CommandFlowStep } from './tower/components/flow/flowDomain.js';

export function asMissionStatusNotification(
	event: unknown
): { type: 'mission.status'; workspaceRoot: string; missionId: string; status: OperatorStatus } | undefined {
	if (!event || typeof event !== 'object') {
		return undefined;
	}
	const candidate = event as { type?: unknown; workspaceRoot?: unknown; missionId?: unknown; status?: unknown };
	if (candidate.type !== 'mission.status') {
		return undefined;
	}
	if (typeof candidate.workspaceRoot !== 'string' || candidate.workspaceRoot.length === 0) {
		return undefined;
	}
	if (typeof candidate.missionId !== 'string' || candidate.missionId.length === 0) {
		return undefined;
	}
	if (!candidate.status || typeof candidate.status !== 'object') {
		return undefined;
	}
	return candidate as { type: 'mission.status'; workspaceRoot: string; missionId: string; status: OperatorStatus };
}

export function createInitialStatusMessage(initialConnectionError?: string): string {
	if (initialConnectionError) {
		return `Tower could not connect immediately: ${initialConnectionError}`;
	}
	return 'Connecting to the Mission daemon.';
}

export function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function buildFocusOrder(input: {
	baseOrder: FocusArea[];
	headerTabsFocusable: boolean;
	showCommandFlow: boolean;
	showCommandPicker: boolean;
	expandedComposer: boolean;
}): FocusArea[] {
	if (input.expandedComposer) {
		return ['flow', 'command'];
	}
	const baseOrder = input.headerTabsFocusable
		? input.baseOrder
		: input.baseOrder.filter((area) => area !== 'header');
	if (!input.showCommandFlow && !input.showCommandPicker) {
		return baseOrder;
	}
	return ['flow', ...baseOrder.filter((area) => area !== 'flow' && area !== 'command'), 'command'];
}

export function buildKeyHintsText(input: {
	focusArea: FocusArea;
	activePicker: 'command-select' | undefined;
	currentFlowStep: CommandFlowStep | undefined;
	towerMode: 'repository' | 'mission';
	commandPanelMode: 'input' | 'toolbar';
	confirmingToolbarCommand: boolean;
}): string {
	if (input.activePicker === 'command-select') {
		return 'Tab/Shift+Tab focus | ↑/↓ navigate | Enter choose | Backspace filter | Esc close | Ctrl+Q quit';
	}
	if (input.focusArea === 'header') {
		return 'Tab/Shift+Tab focus | ←/→ tabs | Enter open | ↑/↓ move focus | Ctrl+Q quit';
	}
	if (input.focusArea === 'command') {
		if (input.commandPanelMode === 'toolbar') {
			if (input.confirmingToolbarCommand) {
				return 'Tab/Shift+Tab focus | ←/→ choose confirm/cancel | Enter apply | Esc cancel | Ctrl+Q quit';
			}
			return 'Tab/Shift+Tab focus | ←/→ command | Enter run | Ctrl+Q quit';
		}
		if (input.currentFlowStep?.kind === 'text') {
			return 'Tab/Shift+Tab focus | Enter continue | Esc cancel | Ctrl+Q quit';
		}
		if (input.currentFlowStep) {
			return 'Tab/Shift+Tab focus | Enter continue | Ctrl+Q quit';
		}
		return 'Tab/Shift+Tab focus | Enter submit | Esc clear | Ctrl+Q quit';
	}
	if (input.focusArea === 'flow' && input.currentFlowStep?.kind === 'selection') {
		if (input.currentFlowStep.selectionMode === 'multiple') {
			return 'Tab/Shift+Tab focus | ↑/↓ navigate | Space toggle | ←/→ step | Enter continue | Ctrl+Q quit';
		}
		return 'Tab/Shift+Tab focus | ↑/↓ navigate | ←/→ step | Enter continue | Ctrl+Q quit';
	}
	if (input.focusArea === 'flow' && input.towerMode === 'repository') {
		if (input.currentFlowStep?.kind === 'text') {
			return 'Tab/Shift+Tab focus | Ctrl+←/→ step | Enter continue | Ctrl+Q quit';
		}
		return 'Tab/Shift+Tab focus | ↑/↓ navigate | ←/→ step | Enter continue | Ctrl+Q quit';
	}
	if (input.focusArea === 'tree') {
		return 'Tab/Shift+Tab focus | ↑/↓ navigate | ←/→ move | PgUp/PgDn scroll | Enter select | Ctrl+Q quit';
	}
	return 'Tab/Shift+Tab focus | Ctrl+Q quit';
}

export function selectorFromTowerState(
	status: OperatorStatus,
	snapshot: MissionSystemSnapshot | undefined,
	fallback: MissionSelector = {}
): MissionSelector {
	if (status.missionId) {
		return { missionId: status.missionId };
	}
	const projectedMissionId = snapshot?.airportProjections.tower.missionId;
	if (projectedMissionId) {
		return { missionId: projectedMissionId };
	}
	if (fallback.missionId) {
		return { missionId: fallback.missionId };
	}
	return {};
}

export function describeControlConnection(status: OperatorStatus): string {
	const control = status.control;
	if (!control) {
		return 'Connected to Mission repository.';
	}
	return control.problems.length > 0
		? 'Connected to Mission setup. Run /setup to finish configuration.'
		: 'Connected to Mission repository.';
}

export function isRecoverableDaemonDisconnect(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('Mission daemon connection closed')
		|| message.includes('Daemon client is not connected')
		|| message.includes('ECONNRESET')
		|| message.includes('EPIPE');
}