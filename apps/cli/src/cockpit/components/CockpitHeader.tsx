/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from '@opentui/solid';
import { createMemo } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import type { PanelBadge } from './Panel.js';
import { TabPanel, type TabPanelLine, type TabPanelTab } from './TabPanel.js';
import type { ProgressRailItem } from './ProgressRail.js';
import { progressConnectorTone, progressStateTone } from './progressStateTone.js';

const HEADER_BORDER_PURPLE = '#a855f7';

type PanelStyle = Record<string, string | number | undefined>;

export type CockpitHeaderTab = TabPanelTab;

type CockpitHeaderProps = {
	panelTitle: string;
	title: string;
	tabs: CockpitHeaderTab[];
	selectedTabId: string | undefined;
	tabsFocusable: boolean;
	focused: boolean;
	stageItems: ProgressRailItem[];
	statusLines: TabPanelLine[];
	footerBadges: PanelBadge[];
	style?: PanelStyle;
};

export function CockpitHeader(props: CockpitHeaderProps) {
	void props.title;
	const terminal = useTerminalDimensions();
	const interiorWidth = createMemo(() => Math.max(terminal().width - 4, 18));
	const bodyLines = createMemo<TabPanelLine[]>(() => {
		const lines: TabPanelLine[] = [];
		lines.push({ text: '', fg: cockpitTheme.metaText });

		for (const line of props.statusLines.slice(0, 1)) {
			lines.push(line);
		}

		if (props.stageItems.length > 0) {
			lines.push({ text: '', fg: cockpitTheme.metaText });
			lines.push({
				segments: buildStageRailLine(props.stageItems, interiorWidth()),
				fg: cockpitTheme.metaText
			});
		}

		return lines;
	});

	return (
		<TabPanel
			title={props.panelTitle}
			titleColor={cockpitTheme.title}
			borderColor={props.focused ? cockpitTheme.accent : HEADER_BORDER_PURPLE}
			backgroundColor={cockpitTheme.headerBackground}
			tabs={props.tabs}
			selectedTabId={props.selectedTabId}
			tabsFocusable={props.tabsFocusable}
			focused={props.focused}
			{...(props.style ? { style: props.style } : {})}
			footerBadges={props.footerBadges}
			bodyLines={bodyLines()}
			bodyRows={Math.max(1, bodyLines().length)}
		/>
	);
}

function buildStageRailLine(
	stageItems: ProgressRailItem[],
	interiorWidth: number
): Array<{ text: string; fg: string }> {
	if (stageItems.length === 0) {
		return [];
	}
	if (interiorWidth <= 2) {
		return [{ text: ' '.repeat(Math.max(interiorWidth, 0)), fg: cockpitTheme.metaText }];
	}

	const availableWidth = Math.max(interiorWidth - 2, 1);
	const parts: Array<{ text: string; fg: string }> = [
		{ text: ' ', fg: cockpitTheme.metaText }
	];

	const markerCount = stageItems.length + 1;
	const usableWidth = Math.max(availableWidth, markerCount + stageItems.length * 5);
	const segmentWidth = Math.floor((usableWidth - markerCount) / stageItems.length);
	let remainder = usableWidth - markerCount - segmentWidth * stageItems.length;

	for (let index = 0; index < stageItems.length; index += 1) {
		const item = stageItems[index];
		if (!item) {
			continue;
		}
		const width = segmentWidth + (remainder > 0 ? 1 : 0);
		if (remainder > 0) {
			remainder -= 1;
		}
		const label = fitStageRailLabel(item.label, Math.max(1, width - 2));
		const connectorBudget = Math.max(0, width - label.length);
		const leftConnectorWidth = Math.floor(connectorBudget / 2);
		const rightConnectorWidth = connectorBudget - leftConnectorWidth;

		parts.push({ text: stageMarker(item.state), fg: stageMarkerColor(item.state) });
		parts.push({ text: '─'.repeat(leftConnectorWidth), fg: stageConnectorColor(item.state) });
		parts.push({ text: label, fg: stageLabelColor(item.state) });
		parts.push({ text: '─'.repeat(rightConnectorWidth), fg: stageConnectorColor(item.state) });

		if (index === stageItems.length - 1) {
			parts.push({ text: stageMarker(item.state), fg: stageMarkerColor(item.state) });
		}
	}

	parts.push({ text: ' ', fg: cockpitTheme.metaText });

	return parts;
}

function fitStageRailLabel(label: string, availableWidth: number): string {
	const safeWidth = Math.max(1, availableWidth);
	const normalized = label.trim();
	const fitted = normalized.length <= safeWidth
		? normalized
		: safeWidth <= 3
			? normalized.slice(0, safeWidth)
			: `${normalized.slice(0, safeWidth - 3)}...`;
	return ` ${fitted} `;
}

function stageMarker(state: ProgressRailItem['state']): string {
	if (state === 'done') {
		return '●';
	}
	if (state === 'active') {
		return '◉';
	}
	if (state === 'blocked') {
		return '◌';
	}
	return '○';
}

function stageMarkerColor(state: ProgressRailItem['state']): string {
	return stageLabelColor(state);
}

function stageLabelColor(state: ProgressRailItem['state']): string {
	return progressStateTone(state);
}

function stageConnectorColor(state: ProgressRailItem['state']): string {
	return progressConnectorTone(state);
}