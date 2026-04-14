const TOWER_MAX_COLUMNS = 100;
const FALLBACK_VIEWPORT_COLUMNS = 200;
const SIDE_BY_SIDE_COMPANION_MIN_COLUMNS = 100;

export function buildAirportBootstrapLayout(input: {
	repoRoot: string;
	towerCommand: string;
	briefingRoomCommand: string;
	runwayCommand: string;
	viewportColumns?: number;
}): string {
	const viewportColumns = resolveViewportColumnsForLayout(input.viewportColumns);
	const towerColumns = resolveTowerColumns(viewportColumns);
	const rightColumnColumns = Math.max(1, viewportColumns - towerColumns);
	const companionPaneDirection = resolveAirportCompanionPaneDirection(rightColumnColumns) === 'right'
		? 'vertical'
		: 'horizontal';
	return `layout {
	tab name="TOWER" split_direction="vertical" {
		pane name="TOWER" focus=true size=${towerColumns} borderless=true command="sh" cwd="${kdlEscape(input.repoRoot)}" {
			args "-lc" "${kdlEscape(`exec ${input.towerCommand}`)}"
		}
		pane split_direction="${companionPaneDirection}" {
			pane name="BRIEFING ROOM" size="50%" command="sh" cwd="${kdlEscape(input.repoRoot)}" {
				args "-lc" "${kdlEscape(`exec ${input.briefingRoomCommand}`)}"
			}
			pane name="RUNWAY" size="50%" command="sh" cwd="${kdlEscape(input.repoRoot)}" {
				args "-lc" "${kdlEscape(`exec ${input.runwayCommand}`)}"
			}
		}
	}
}
`;
}

export function resolveAirportCompanionPaneDirection(availableColumns: number | undefined): 'down' | 'right' {
	return typeof availableColumns === 'number' && Number.isFinite(availableColumns) && availableColumns >= SIDE_BY_SIDE_COMPANION_MIN_COLUMNS
		? 'right'
		: 'down';
}

function resolveViewportColumnsForLayout(viewportColumns: number | undefined): number {
	if (typeof viewportColumns === 'number' && Number.isFinite(viewportColumns) && viewportColumns > 0) {
		return Math.round(viewportColumns);
	}
	return FALLBACK_VIEWPORT_COLUMNS;
}

function resolveTowerColumns(viewportColumns: number): number {
	if (viewportColumns <= 1) {
		return 1;
	}
	const halfViewportColumns = Math.max(1, Math.floor(viewportColumns / 2));
	return Math.max(1, Math.min(TOWER_MAX_COLUMNS, halfViewportColumns, viewportColumns - 1));
}

function kdlEscape(value: string): string {
	return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}
