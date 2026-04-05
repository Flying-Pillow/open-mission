import { cockpitTheme } from './cockpitTheme.js';
import type { ProgressRailItemState } from './ProgressRail.js';

type ProgressStateTone = ProgressRailItemState | 'todo';

export function progressStateTone(state: ProgressStateTone): string {
	if (state === 'done') {
		return cockpitTheme.success;
	}
	if (state === 'active') {
		return cockpitTheme.accent;
	}
	if (state === 'blocked') {
		return cockpitTheme.warning;
	}
	return cockpitTheme.secondaryText;
}

export function progressConnectorTone(state: ProgressStateTone): string {
	if (state === 'done') {
		return cockpitTheme.success;
	}
	if (state === 'active') {
		return cockpitTheme.accent;
	}
	if (state === 'blocked') {
		return cockpitTheme.warning;
	}
	return cockpitTheme.borderMuted;
}