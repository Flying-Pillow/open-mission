const TOWER_DEFAULT_WIDTH_PERCENT = 33;
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
	resolveTowerColumns(viewportColumns);
	return `layout {
	tab name="TOWER" split_direction="vertical" {
		pane name="TOWER" focus=true size="${TOWER_DEFAULT_WIDTH_PERCENT}%" command="sh" cwd="${kdlEscape(input.repoRoot)}" {
			args "-lc" "${kdlEscape(`exec ${input.towerCommand}`)}"
		}
		pane name="BRIEFING ROOM" size="33%" command="sh" cwd="${kdlEscape(input.repoRoot)}" {
			args "-lc" "${kdlEscape(`exec ${input.briefingRoomCommand}`)}"
		}
		pane name="RUNWAY" size="34%" borderless=true command="sh" cwd="${kdlEscape(input.repoRoot)}" {
			args "-lc" "${kdlEscape(`exec ${input.runwayCommand}`)}"
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
	const towerColumns = Math.round((TOWER_DEFAULT_WIDTH_PERCENT * viewportColumns) / 100);
	return Math.max(1, Math.min(towerColumns, viewportColumns - 1));
}

function kdlEscape(value: string): string {
	return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}
