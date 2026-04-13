import { towerTheme } from '../towerTheme.js';
import type { ProgressRailItemState } from './headerDomain.js';

type ProgressStateTone = ProgressRailItemState;

export function progressStateTone(state: ProgressStateTone): string {
	if (state === 'completed') {
		return towerTheme.success;
	}
	if (state === 'active') {
		return towerTheme.accent;
	}
	if (state === 'ready') {
		return towerTheme.brightText;
	}
	if (state === 'blocked') {
		return towerTheme.warning;
	}
	return towerTheme.secondaryText;
}

export function progressConnectorTone(state: ProgressStateTone): string {
	if (state === 'completed') {
		return towerTheme.success;
	}
	if (state === 'active') {
		return towerTheme.accent;
	}
	if (state === 'ready') {
		return towerTheme.brightText;
	}
	if (state === 'blocked') {
		return towerTheme.warning;
	}
	return towerTheme.borderMuted;
}