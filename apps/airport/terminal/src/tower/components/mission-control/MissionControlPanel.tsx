/** @jsxImportSource @opentui/solid */

import type { ScrollBoxRenderable } from '@opentui/core';
import type { MissionLifecycleState } from '@flying-pillow/mission-core';
import { useTerminalDimensions } from '@opentui/solid';
import { For, Show, createEffect, createMemo, type Accessor } from 'solid-js';
import { Panel } from '../Panel.js';
import { towerTheme } from '../towerTheme.js';

export type MissionControlRow = {
	id: string;
	label: string;
	depth: number;
	collapsible: boolean;
	collapsed: boolean;
	color: string;
	statusLabel?: string;
};

type MissionControlPanelProps = {
	focused: boolean;
	rows: MissionControlRow[];
	selectedRowId: string | undefined;
	missionLifecycleState?: MissionLifecycleState | undefined;
	treePageScrollRequest: { delta: number } | undefined;
	contentWidth?: number | undefined;
	emptyLabel: string;
	onMoveSelection: (delta: number) => void;
	onPageScroll: (delta: number) => void;
	onActivateSelection: () => void;
};

type TreeLine = {
	id: string;
	text: string;
	statusBadgeText: string;
	color: string;
	selected: boolean;
	backgroundColor: string;
};

export function MissionControlPanel(props: MissionControlPanelProps) {
	const terminal = useTerminalDimensions();
	let scrollboxRef: ScrollBoxRenderable | undefined;
	const lines = createMemo<TreeLine[]>(() => buildTreeLines(props.rows, props.selectedRowId));
	const lifecycleBadges = createMemo(() => resolveMissionLifecycleBadges(props.missionLifecycleState));
	const treeContentWidth = createMemo(() => {
		if (typeof props.contentWidth === 'number' && Number.isFinite(props.contentWidth)) {
			return Math.max(12, Math.floor(props.contentWidth));
		}
		return Math.max(terminal().width - 8, 20);
	});

	createEffect(() => {
		const selectedRowId = props.selectedRowId;
		const currentLines = lines();
		if (!selectedRowId || !scrollboxRef || currentLines.length === 0) {
			return;
		}
		const selectedIndex = currentLines.findIndex((line) => line.id === selectedRowId);
		if (selectedIndex < 0) {
			return;
		}
		const viewportHeight = Math.max(1, scrollboxRef.viewport.height);
		const visibleTop = Math.max(0, Math.floor(scrollboxRef.scrollTop));
		const visibleBottom = visibleTop + viewportHeight - 1;
		if (selectedIndex < visibleTop) {
			scrollboxRef.scrollTop = selectedIndex;
			return;
		}
		if (selectedIndex > visibleBottom) {
			scrollboxRef.scrollTop = selectedIndex - viewportHeight + 1;
		}
	});

	createEffect(() => {
		const request = props.treePageScrollRequest;
		if (!request || !scrollboxRef) {
			return;
		}
		scrollboxRef.scrollBy(request.delta / 2, 'viewport');
	});

	return (
		<Panel
			title="MISSION-CONTROL"
			titleColor={towerTheme.title}
			borderColor={props.focused ? towerTheme.accent : towerTheme.border}
			{...(lifecycleBadges() ? { footerBadges: lifecycleBadges() } : {})}
			contentWidth={treeContentWidth()}
			style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0 }}
			contentStyle={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}
		>
			<Show
				when={lines().length > 0}
				fallback={<text style={{ fg: towerTheme.secondaryText }}>{props.emptyLabel}</text>}
			>
				<scrollbox
					ref={(value) => {
						scrollboxRef = value;
					}}
					focused={props.focused}
					onKeyDown={(event) => {
						if (event.name === 'up') {
							event.preventDefault();
							event.stopPropagation();
							props.onMoveSelection(-1);
							return;
						}
						if (event.name === 'down') {
							event.preventDefault();
							event.stopPropagation();
							props.onMoveSelection(1);
							return;
						}
						if (event.name === 'left') {
							event.preventDefault();
							event.stopPropagation();
							props.onMoveSelection(-1);
							return;
						}
						if (event.name === 'right') {
							event.preventDefault();
							event.stopPropagation();
							props.onMoveSelection(1);
							return;
						}
						if (event.name === 'pageup') {
							event.preventDefault();
							event.stopPropagation();
							props.onPageScroll(-1);
							return;
						}
						if (event.name === 'pagedown') {
							event.preventDefault();
							event.stopPropagation();
							props.onPageScroll(1);
							return;
						}
						if (event.name === 'enter' || event.name === 'return') {
							event.preventDefault();
							event.stopPropagation();
							props.onActivateSelection();
						}
					}}
					style={{
						flexGrow: 1,
						flexShrink: 1,
						minHeight: 0,
						scrollbarOptions: {
							trackOptions: {
								foregroundColor: props.focused ? towerTheme.accent : towerTheme.border,
								backgroundColor: towerTheme.panelBackground
							}
						}
					}}
				>
					<box style={{ flexDirection: 'column', minHeight: 0 }}>
						<For each={lines()}>
							{(line) => <MissionControlTreeRow line={line} width={treeContentWidth} />}
						</For>
					</box>
				</scrollbox>
			</Show>
		</Panel>
	);
}

function MissionControlTreeRow(props: { line: TreeLine; width: Accessor<number> }) {
	const rowLayout = createMemo(() =>
		formatTreeRow(props.line.text, props.line.statusBadgeText, props.width())
	);

	return (
		<box
			id={props.line.id}
			style={{
				flexDirection: 'row',
				backgroundColor: props.line.selected ? props.line.backgroundColor : towerTheme.panelBackground
			}}
		>
			<text style={{ fg: props.line.selected ? towerTheme.primaryText : props.line.color }}>
				{rowLayout().label}
			</text>
			<text style={{ fg: props.line.selected ? towerTheme.primaryText : props.line.color }}>
				{rowLayout().spacer}
			</text>
			<text
				style={{
					fg: props.line.color,
					bg: props.line.selected ? props.line.backgroundColor : towerTheme.panelBackground
				}}
			>
				{rowLayout().badge}
			</text>
		</box>
	);
}

function buildTreeLines(rows: MissionControlRow[], selectedRowId: string | undefined): TreeLine[] {
	return rows.map((row) => {
		const indent = '  '.repeat(Math.max(0, row.depth));
		const disclosure = row.collapsible ? `${row.collapsed ? '▸' : '▾'} ` : '  ';
		const selected = row.id === selectedRowId;
		return {
			id: row.id,
			text: `${indent}${disclosure}${row.label}`,
			statusBadgeText: `[${toStatusBadgeLabel(row.statusLabel)}]`,
			color: row.color,
			selected,
			backgroundColor: selectedRowBackground(row.color)
		};
	});
}

function selectedRowBackground(statusColor: string): string {
	const mixed = mixHexColors(towerTheme.panelBackground, statusColor, 0.28);
	return mixed ?? towerTheme.accentSoft;
}

function mixHexColors(base: string, tone: string, toneWeight: number): string | undefined {
	const baseRgb = hexToRgb(base);
	const toneRgb = hexToRgb(tone);
	if (!baseRgb || !toneRgb) {
		return undefined;
	}
	const weight = Math.max(0, Math.min(1, toneWeight));
	const r = Math.round(baseRgb.r * (1 - weight) + toneRgb.r * weight);
	const g = Math.round(baseRgb.g * (1 - weight) + toneRgb.g * weight);
	const b = Math.round(baseRgb.b * (1 - weight) + toneRgb.b * weight);
	return rgbToHex(r, g, b);
}

function hexToRgb(value: string): { r: number; g: number; b: number } | undefined {
	const match = /^#([0-9a-fA-F]{6})$/u.exec(value.trim());
	const hex = match?.[1];
	if (!hex) {
		return undefined;
	}
	return {
		r: Number.parseInt(hex.slice(0, 2), 16),
		g: Number.parseInt(hex.slice(2, 4), 16),
		b: Number.parseInt(hex.slice(4, 6), 16)
	};
}

function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function fitTreeRow(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const singleLine = text.replace(/[\r\n\t\f\v]+/g, ' ');
	return singleLine.slice(0, safeWidth);
}

function formatTreeRow(
	text: string,
	badge: string,
	width: number
): { label: string; spacer: string; badge: string } {
	const safeWidth = Math.max(1, width);
	if (safeWidth <= badge.length) {
		return {
			label: '',
			spacer: '',
			badge: badge.slice(0, safeWidth)
		};
	}
	const singleLine = fitTreeRow(text, safeWidth);
	const labelBudget = Math.max(1, safeWidth - badge.length - 1);
	const label = singleLine.slice(0, labelBudget);
	const spacerWidth = Math.max(1, safeWidth - label.length - badge.length);
	return {
		label,
		spacer: ' '.repeat(spacerWidth),
		badge
	};
}

function toStatusBadgeLabel(statusLabel: string | undefined): string {
	const normalized = statusLabel?.trim().toUpperCase();
	if (!normalized || normalized.length === 0) {
		return 'UNKNOWN';
	}
	if (normalized === 'UNKOWN') {
		return 'UNKNOWN';
	}
	return normalized;
}

function resolveMissionLifecycleBadges(
	missionLifecycleState: string | undefined
): Array<{ text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }> | undefined {
	const normalized = missionLifecycleState?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	return [{ text: `mission ${normalized}`, tone: missionLifecycleTone(normalized) }];
}

function missionLifecycleTone(
	missionLifecycleState: string
): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
	if (missionLifecycleState === 'panicked') {
		return 'danger';
	}
	if (missionLifecycleState === 'paused') {
		return 'warning';
	}
	if (missionLifecycleState === 'running') {
		return 'success';
	}
	if (missionLifecycleState === 'ready') {
		return 'accent';
	}
	return 'neutral';
}