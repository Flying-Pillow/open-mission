/** @jsxImportSource @opentui/solid */

import type { ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { For, Show, createEffect, createMemo } from 'solid-js';
import { Panel } from '../Panel.js';
import { cockpitTheme } from '../cockpitTheme.js';

export type MissionFlightDeckRow = {
	id: string;
	label: string;
	depth: number;
	collapsible: boolean;
	collapsed: boolean;
	color: string;
};

type MissionFlightDeckPanelProps = {
	focused: boolean;
	rows: MissionFlightDeckRow[];
	selectedRowId: string | undefined;
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
	color: string;
	selected: boolean;
	backgroundColor: string;
};

export function MissionFlightDeckPanel(props: MissionFlightDeckPanelProps) {
	const terminal = useTerminalDimensions();
	let scrollboxRef: ScrollBoxRenderable | undefined;
	const lines = createMemo<TreeLine[]>(() => buildTreeLines(props.rows, props.selectedRowId));
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
			title="FLIGHT-DECK"
			titleColor={cockpitTheme.title}
			borderColor={props.focused ? cockpitTheme.accent : cockpitTheme.border}
			contentWidth={treeContentWidth()}
			style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0 }}
			contentStyle={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}
		>
			<Show
				when={lines().length > 0}
				fallback={<text style={{ fg: cockpitTheme.secondaryText }}>{props.emptyLabel}</text>}
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
								foregroundColor: props.focused ? cockpitTheme.accent : cockpitTheme.border,
								backgroundColor: cockpitTheme.panelBackground
							}
						}
					}}
				>
					<box style={{ flexDirection: 'column', minHeight: 0 }}>
						<For each={lines()}>
							{(line) => (
								<box
									id={line.id}
									style={{
										flexDirection: 'row',
										backgroundColor: line.selected ? line.backgroundColor : cockpitTheme.panelBackground
									}}
								>
									<text style={{ fg: line.selected ? cockpitTheme.primaryText : line.color }}>
										{fitTreeRow(line.text, treeContentWidth())}
									</text>
								</box>
							)}
						</For>
					</box>
				</scrollbox>
			</Show>
		</Panel>
	);
}

function buildTreeLines(rows: MissionFlightDeckRow[], selectedRowId: string | undefined): TreeLine[] {
	return rows.map((row) => {
		const indent = '  '.repeat(Math.max(0, row.depth));
		const disclosure = row.collapsible ? `${row.collapsed ? '▸' : '▾'} ` : '  ';
		const selected = row.id === selectedRowId;
		return {
			id: row.id,
			text: `${indent}${disclosure}${row.label}`,
			color: row.color,
			selected,
			backgroundColor: selectedRowBackground(row.color)
		};
	});
}

function selectedRowBackground(statusColor: string): string {
	const mixed = mixHexColors(cockpitTheme.panelBackground, statusColor, 0.28);
	return mixed ?? cockpitTheme.accentSoft;
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