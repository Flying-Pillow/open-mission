const TOWER_DEFAULT_COLUMNS = 100;
const FALLBACK_VIEWPORT_COLUMNS = 200;
const SIDE_BY_SIDE_COMPANION_MIN_COLUMNS = 80;

export function buildAirportBootstrapLayout(input: {
	repoRoot: string;
	towerCommand: string;
	briefingRoomCommand: string;
	viewportColumns?: number;
}): string {
	const viewportColumns = resolveViewportColumnsForLayout(input.viewportColumns);
	const towerWidthPercent = resolveTowerWidthPercent(viewportColumns);
	const rightColumnWidthPercent = 100 - towerWidthPercent;
	return `layout {
	default_tab_template {
		children
	}
	tab name="TOWER" {
		pane split_direction="vertical" {
			pane name="TOWER" focus=true size="${towerWidthPercent}%" borderless=true command="sh" cwd="${kdlEscape(input.repoRoot)}" {
				args "-lc" "${kdlEscape(`exec ${input.towerCommand}`)}"
			}
			pane name="BRIEFING ROOM" size="${rightColumnWidthPercent}%" command="sh" cwd="${kdlEscape(input.repoRoot)}" {
				args "-lc" "${kdlEscape(`exec ${input.briefingRoomCommand}`)}"
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

function resolveTowerWidthPercent(viewportColumns: number): number {
	const widthPercent = Math.round((TOWER_DEFAULT_COLUMNS * 100) / viewportColumns);
	return Math.max(1, Math.min(100, widthPercent));
}

function kdlEscape(value: string): string {
	return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}
