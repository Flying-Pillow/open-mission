/** @jsxImportSource @opentui/solid */

import { useKeyboard, useTerminalDimensions, useTimeline } from '@opentui/solid';
import { createMemo, createSignal, onMount } from 'solid-js';
import { towerTheme } from '../towerTheme.js';
import type { PanelBadge } from '../Panel.js';
import { TabPanel, type TabPanelLine, type TabPanelTab } from '../TabPanel.js';
import type { ProgressRailItem } from './headerDomain.js';
import { progressConnectorTone, progressStateTone } from './progressStateTone.js';

const HEADER_BORDER_PURPLE = '#a855f7';
const HEADER_BODY_ROWS = 3;

type PanelStyle = Record<string, string | number | undefined>;

export type HeaderPanelTab = TabPanelTab;

type HeaderPanelProps = {
	panelTitle: string;
	title: string;
	tabs: HeaderPanelTab[];
	selectedTabId: string | undefined;
	tabsFocusable: boolean;
	focused: boolean;
	stageItems: ProgressRailItem[];
	statusLines: TabPanelLine[];
	footerBadges: PanelBadge[];
	onMoveSelection?: (delta: number) => void;
	onMoveFocus?: (delta: number) => void;
	onSelectTab?: () => void;
	style?: PanelStyle;
};

export function HeaderPanel(props: HeaderPanelProps) {
	void props.title;
	const terminal = useTerminalDimensions();
	const [timelinePhase, setTimelinePhase] = createSignal(0);
	const timeline = useTimeline({ duration: 2800, loop: false });
	const interiorWidth = createMemo(() => Math.max(terminal().width - 4, 18));

	onMount(() => {
		const animationState = { phase: 0 };
		timeline.add(animationState, {
			phase: 1,
			duration: 2800,
			ease: 'linear',
			onUpdate: (animation) => {
				const target = animation.targets[0] as { phase: number };
				setTimelinePhase(Math.max(0, Math.min(target.phase, 1)));
			}
		});
	});

	const bodyLines = createMemo<TabPanelLine[]>(() => {
		const lines: TabPanelLine[] = [];
		for (const line of props.statusLines.slice(0, 2)) {
			lines.push(line);
		}

		if (props.stageItems.length > 0) {
			lines.push({
				segments: buildStageTimelineLine(props.stageItems, interiorWidth(), timelinePhase()),
				fg: towerTheme.metaText
			});
		}

		return lines.slice(0, HEADER_BODY_ROWS);
	});

	useKeyboard((event) => {
		if (!props.focused) {
			return;
		}
		if (event.name === 'up') {
			event.preventDefault();
			event.stopPropagation();
			props.onMoveFocus?.(-1);
			return;
		}
		if (event.name === 'down') {
			event.preventDefault();
			event.stopPropagation();
			props.onMoveFocus?.(1);
			return;
		}
		if (!props.tabsFocusable) {
			return;
		}
		if (event.name === 'left') {
			event.preventDefault();
			event.stopPropagation();
			props.onMoveSelection?.(-1);
			return;
		}
		if (event.name === 'right') {
			event.preventDefault();
			event.stopPropagation();
			props.onMoveSelection?.(1);
			return;
		}
		if (event.name === 'enter' || event.name === 'return') {
			event.preventDefault();
			event.stopPropagation();
			props.onSelectTab?.();
		}
	});

	return (
		<TabPanel
			title={props.panelTitle}
			titleColor={towerTheme.title}
			borderColor={props.focused ? towerTheme.accent : HEADER_BORDER_PURPLE}
			backgroundColor={towerTheme.headerBackground}
			tabs={props.tabs}
			selectedTabId={props.selectedTabId}
			tabsFocusable={props.tabsFocusable}
			focused={props.focused}
			{...(props.style ? { style: props.style } : {})}
			footerBadges={props.footerBadges}
			bodyLines={bodyLines()}
			bodyRows={HEADER_BODY_ROWS}
		/>
	);
}

type HeaderLineSegment = { text: string; fg: string };

type StageRailLayout = {
	availableWidth: number;
	segmentWidths: number[];
};

function buildStageTimelineLine(
	stageItems: ProgressRailItem[],
	interiorWidth: number,
	timelinePhase: number
): HeaderLineSegment[] {
	if (stageItems.length === 0) {
		return [];
	}
	if (interiorWidth <= 2) {
		return [{ text: ' '.repeat(Math.max(interiorWidth, 0)), fg: towerTheme.metaText }];
	}

	const layout = buildStageRailLayout(stageItems, interiorWidth);
	const activeStageIndex = resolveAnimatedStageIndex(stageItems);
	const animatedTrackWidth = layout.segmentWidths
		.slice(0, activeStageIndex + 1)
		.reduce((total, width) => total + width, 0);
	const sweepIndex = animatedTrackWidth > 0
		? Math.min(animatedTrackWidth - 1, Math.floor(timelinePhase * animatedTrackWidth))
		: -1;

	const parts: HeaderLineSegment[] = [{ text: ' ', fg: towerTheme.metaText }];
	let traversedWidth = 0;

	for (let index = 0; index < stageItems.length; index += 1) {
		const item = stageItems[index];
		if (!item) {
			continue;
		}

		const width = layout.segmentWidths[index] ?? 1;
		const label = fitStageRailLabel(item.label, Math.max(1, width - 2));
		parts.push({
			text: timelineMarker(item.state, item.state === 'active', timelinePhase),
			fg: timelineMarkerColor(item.state, item.state === 'active', timelinePhase)
		});
		parts.push(
			...buildTimelineTrackSegments({
				state: item.state,
				width,
				label,
				sweepIndex,
				trackOffset: traversedWidth,
				animateSweep: index <= activeStageIndex
			})
		);
		traversedWidth += width;

		if (index === stageItems.length - 1) {
			parts.push({
				text: timelineMarker(item.state, item.state === 'active', timelinePhase),
				fg: timelineMarkerColor(item.state, item.state === 'active', timelinePhase)
			});
		}
	}

	parts.push({ text: ' ', fg: towerTheme.metaText });
	return parts;
}

function buildStageRailLayout(stageItems: ProgressRailItem[], interiorWidth: number): StageRailLayout {
	const availableWidth = Math.max(interiorWidth - 2, 1);
	const markerCount = stageItems.length + 1;
	const usableWidth = Math.max(availableWidth, markerCount + stageItems.length * 5);
	const segmentWidth = Math.floor((usableWidth - markerCount) / stageItems.length);
	let remainder = usableWidth - markerCount - segmentWidth * stageItems.length;
	const segmentWidths = stageItems.map(() => {
		const width = segmentWidth + (remainder > 0 ? 1 : 0);
		if (remainder > 0) {
			remainder -= 1;
		}
		return width;
	});
	return {
		availableWidth,
		segmentWidths
	};
}

function resolveAnimatedStageIndex(stageItems: ProgressRailItem[]): number {
	const activeIndex = stageItems.findIndex((item) => item.state === 'active');
	if (activeIndex >= 0) {
		return activeIndex;
	}
	const blockedIndex = stageItems.findIndex((item) => item.state === 'blocked');
	if (blockedIndex >= 0) {
		return blockedIndex;
	}
	const doneIndex = stageItems
		.map((item, index) => ({ item, index }))
		.filter(({ item }) => item.state === 'completed')
		.map(({ index }) => index)
		.at(-1);
	if (doneIndex !== undefined) {
		return doneIndex;
	}
	return 0;
}

function buildTimelineTrackSegments(options: {
	state: ProgressRailItem['state'];
	width: number;
	label: string;
	sweepIndex: number;
	trackOffset: number;
	animateSweep: boolean;
}): HeaderLineSegment[] {
	const segments: HeaderLineSegment[] = [];
	const safeLabel = options.label.slice(0, Math.max(options.width, 0));
	const labelStart = Math.max(0, Math.floor((options.width - safeLabel.length) / 2));
	const labelEnd = labelStart + safeLabel.length;
	for (let index = 0; index < options.width; index += 1) {
		if (index >= labelStart && index < labelEnd) {
			segments.push({
				text: safeLabel[index - labelStart] ?? ' ',
				fg: timelineLabelColor(options.state)
			});
			continue;
		}
		const absoluteIndex = options.trackOffset + index;
		const sweepDistance = options.sweepIndex >= 0 ? options.sweepIndex - absoluteIndex : Number.NEGATIVE_INFINITY;
		if (options.animateSweep && sweepDistance === 0) {
			segments.push({ text: '◆', fg: towerTheme.brightText });
			continue;
		}
		if (options.animateSweep && sweepDistance === 1) {
			segments.push({ text: '•', fg: towerTheme.accent });
			continue;
		}
		if (options.animateSweep && sweepDistance === 2) {
			segments.push({ text: '·', fg: towerTheme.metaText });
			continue;
		}
		segments.push({
			text: timelineTrackChar(options.state),
			fg: timelineTrackColor(options.state)
		});
	}
	return segments;
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

function stageLabelColor(state: ProgressRailItem['state']): string {
	return progressStateTone(state);
}

function stageConnectorColor(state: ProgressRailItem['state']): string {
	return progressConnectorTone(state);
}

function timelineMarker(
	state: ProgressRailItem['state'],
	isActive: boolean,
	timelinePhase: number
): string {
	if (state === 'completed') {
		return '◆';
	}
	if (state === 'active') {
		return isActive && timelinePhase >= 0.5 ? '✦' : '◆';
	}
	if (state === 'blocked') {
		return '◈';
	}
	return '◇';
}

function timelineMarkerColor(
	state: ProgressRailItem['state'],
	isActive: boolean,
	timelinePhase: number
): string {
	if (isActive && state === 'active' && timelinePhase >= 0.5) {
		return towerTheme.brightText;
	}
	return stageLabelColor(state);
}

function timelineTrackChar(state: ProgressRailItem['state']): string {
	if (state === 'completed') {
		return '═';
	}
	if (state === 'active') {
		return '─';
	}
	if (state === 'blocked') {
		return '┄';
	}
	return '·';
}

function timelineTrackColor(state: ProgressRailItem['state']): string {
	if (state === 'pending') {
		return towerTheme.borderMuted;
	}
	return stageConnectorColor(state);
}

function timelineLabelColor(state: ProgressRailItem['state']): string {
	if (state === 'pending') {
		return towerTheme.secondaryText;
	}
	return stageLabelColor(state);
}