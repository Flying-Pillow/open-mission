/** @jsxImportSource @opentui/solid */

import { For, Show, createMemo, type JSXElement } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import type { PanelBadge, PanelBadgeTone } from './Panel.js';
import { cockpitTheme } from './cockpitTheme.js';

type PanelStyle = Record<string, string | number | undefined>;

export type TabPanelTab = {
	id: string;
	label: string;
	labelColor?: string;
};

export type TabPanelLine = {
	text?: string;
	fg?: string;
	segments?: Array<{
		text: string;
		fg: string;
	}>;
};

export type TabPanelProps = {
	focused: boolean;
	tabs: TabPanelTab[];
	selectedTabId: string | undefined;
	tabsFocusable?: boolean;
	title?: string;
	titleColor?: string;
	borderColor?: string;
	backgroundColor?: string;
	footerBadges?: PanelBadge[];
	style?: PanelStyle;
	contentStyle?: PanelStyle;
	bodyLines?: TabPanelLine[];
	bodyRows?: number;
	children?: JSXElement;
};

export function TabPanel(props: TabPanelProps) {
	void props.title;
	void props.titleColor;

	const terminal = useTerminalDimensions();
	const panelWidth = createMemo(() => Math.max(terminal().width - 2, 20));
	const interiorWidth = createMemo(() => Math.max(panelWidth() - 2, 18));
	const rows = createMemo(() => Math.max(1, props.bodyRows ?? 1));
	const borderColor = createMemo(() =>
		props.borderColor ?? (props.focused ? cockpitTheme.accent : cockpitTheme.border)
	);
	const panelBackground = createMemo(() => props.backgroundColor ?? cockpitTheme.panelBackground);

	const tabLayouts = createMemo(() => {
		const layouts: Array<{ tab: TabPanelTab; x: number; width: number; renderedLabel: string }> = [];
		const selectedId = props.selectedTabId;
		let cursor = 1;
		for (const tab of props.tabs) {
			if (layouts.length > 0) {
				cursor += 2;
			}
			const remainingWidth = interiorWidth() - cursor;
			if (remainingWidth < 5) {
				break;
			}
			const renderedLabel = fitTabLabel(tab.label, remainingWidth - 4);
			const width = renderedLabel.length + 4;
			layouts.push({ tab, x: cursor, width, renderedLabel });
			cursor += width;
		}

		if (
			selectedId
			&& !layouts.some((layout) => layout.tab.id === selectedId)
		) {
			const selectedTab = props.tabs.find((tab) => tab.id === selectedId);
			if (selectedTab) {
				const selectedLabel = fitTabLabel(selectedTab.label, Math.max(interiorWidth() - 4, 1));
				return [{
					tab: selectedTab,
					x: 1,
					width: selectedLabel.length + 4,
					renderedLabel: selectedLabel
				}];
			}
		}
		return layouts;
	});

	const selectedLayout = createMemo(() => {
		const selectedId = props.selectedTabId;
		return tabLayouts().find((layout) => layout.tab.id === selectedId) ?? tabLayouts()[0];
	});

	const renderedTabLayouts = createMemo(() => {
		const layouts = tabLayouts();
		return layouts.map((layout, index) => {
			const previous = layouts[index - 1];
			const previousEnd = previous ? previous.x + previous.width : 0;
			const gap = index === 0 ? layout.x + 1 : Math.max(layout.x - previousEnd, 0);
			return { ...layout, gap };
		});
	});

	const topTabLine = createMemo(() => {
		const selected = selectedLayout();
		if (!selected) {
			return ''.padEnd(panelWidth(), ' ');
		}
		const line = `${' '.repeat(selected.x + 1)}╭${'─'.repeat(Math.max(selected.width - 2, 1))}╮`;
		return line.padEnd(panelWidth(), ' ');
	});

	const topBorderLine = createMemo(() => {
		const selected = selectedLayout();
		if (!selected) {
			return `╭${'─'.repeat(interiorWidth())}╮`;
		}
		const left = '─'.repeat(Math.max(selected.x, 0));
		const gap = ' '.repeat(Math.max(selected.width - 2, 0));
		const rightWidth = Math.max(interiorWidth() - selected.x - selected.width, 0);
		return `╭${left}╯${gap}╰${'─'.repeat(rightWidth)}╮`;
	});

	const bottomBorderLine = createMemo(() => `╰${'─'.repeat(interiorWidth())}╯`);

	const tabLabelSegments = createMemo(() => {
		const segments: Array<{ text: string; fg: string }> = [];
		const selectedId = selectedLayout()?.tab.id;
		let usedWidth = 0;

		for (const layout of renderedTabLayouts()) {
			const gapText = ' '.repeat(layout.gap);
			segments.push({ text: gapText, fg: borderColor() });
			usedWidth += gapText.length;

			if (layout.tab.id === selectedId) {
				segments.push({ text: '│ ', fg: borderColor() });
				segments.push({ text: layout.renderedLabel, fg: cockpitTheme.brightText });
				segments.push({ text: ' │', fg: borderColor() });
			} else {
				segments.push({ text: `  ${layout.renderedLabel}  `, fg: layout.tab.labelColor ?? cockpitTheme.mutedText });
			}
			usedWidth += layout.width;
		}
		if (usedWidth < panelWidth()) {
			segments.push({ text: ' '.repeat(panelWidth() - usedWidth), fg: borderColor() });
		}

		if (props.tabsFocusable === true) {
			const marker = props.focused ? '<>' : '  ';
			if (segments.length > 0) {
				const last = segments[segments.length - 1];
				if (last && last.text.length >= marker.length) {
					last.text = `${last.text.slice(0, Math.max(last.text.length - marker.length, 0))}${marker}`;
				}
			}
		}

		return segments;
	});

	const visibleBodyLines = createMemo(() => {
		const lines = (props.bodyLines ?? []).slice(0, rows());
		while (lines.length < rows()) {
			lines.push({ text: '', fg: cockpitTheme.bodyText });
		}
		return lines;
	});

	const footerSegments = createMemo(() => renderFooterSegments(props.footerBadges ?? []));

	return (
		<box style={{ flexDirection: 'column', ...(props.style ?? {}) }}>
			<text style={{ fg: borderColor() }}>{topTabLine()}</text>
			<box style={{ flexDirection: 'row', backgroundColor: panelBackground() }}>
				<For each={tabLabelSegments()}>
					{(segment) => <text style={{ fg: segment.fg }}>{segment.text}</text>}
				</For>
			</box>
			<text style={{ fg: borderColor() }}>{topBorderLine()}</text>

			<Show
				when={props.children !== undefined}
				fallback={
					<For each={visibleBodyLines()}>
						{(line) => (
							<box style={{ flexDirection: 'row', backgroundColor: panelBackground() }}>
								<text style={{ fg: borderColor() }}>│</text>
								<Show
									when={line.segments !== undefined && line.segments.length > 0}
									fallback={<text style={{ fg: line.fg ?? cockpitTheme.bodyText }}>{fitPanelText(line.text ?? '', interiorWidth())}</text>}
								>
									<For each={fitPanelSegments(line.segments ?? [], interiorWidth(), line.fg ?? cockpitTheme.bodyText)}>
										{(segment) => <text style={{ fg: segment.fg }}>{segment.text}</text>}
									</For>
								</Show>
								<text style={{ fg: borderColor() }}>│</text>
							</box>
						)}
					</For>
				}
			>
				<box
					style={{
						flexDirection: 'row',
						width: panelWidth(),
						backgroundColor: panelBackground(),
						...(props.contentStyle ?? {})
					}}
				>
					<text style={{ fg: borderColor() }}>│</text>
					<box
						style={{
							flexDirection: 'column',
							width: interiorWidth(),
							minWidth: interiorWidth(),
							maxWidth: interiorWidth(),
							flexGrow: 1,
							flexShrink: 1
						}}
					>
						{props.children}
					</box>
					<text style={{ fg: borderColor() }}>│</text>
				</box>
			</Show>

			<Show when={footerSegments().length > 0}>
				<box
					style={{
						flexDirection: 'row',
						justifyContent: 'flex-end',
						paddingRight: 2,
						marginBottom: -1
					}}
				>
					<For each={footerSegments()}>
						{(segment) => <text style={{ fg: footerToneColor(segment.tone) }}>{segment.text}</text>}
					</For>
				</box>
			</Show>

			<text style={{ fg: borderColor() }}>{bottomBorderLine()}</text>
		</box>
	);
}

function fitTabLabel(label: string, maxWidth: number): string {
	const safeWidth = Math.max(1, maxWidth);
	if (label.length <= safeWidth) {
		return label;
	}
	if (safeWidth <= 3) {
		return label.slice(0, safeWidth);
	}
	return `${label.slice(0, safeWidth - 3)}...`;
}


function fitPanelText(text: string, width: number): string {
	if (width <= 0) {
		return '';
	}
	if (width === 1) {
		return ' ';
	}
	const innerWidth = width - 1;
	return ` ${text.slice(0, innerWidth).padEnd(innerWidth, ' ')}`;
}

function fitPanelSegments(
	segments: Array<{ text: string; fg: string }>,
	width: number,
	fallbackFg: string
): Array<{ text: string; fg: string }> {
	if (width <= 0) {
		return [];
	}

	const fitted: Array<{ text: string; fg: string }> = [];
	let remainingWidth = width;

	for (const segment of segments) {
		if (remainingWidth <= 0) {
			break;
		}
		const clipped = segment.text.slice(0, remainingWidth);
		if (clipped.length === 0) {
			continue;
		}
		fitted.push({ text: clipped, fg: segment.fg });
		remainingWidth -= clipped.length;
	}

	if (remainingWidth > 0) {
		fitted.push({ text: ' '.repeat(remainingWidth), fg: fallbackFg });
	}

	return fitted;
}

function renderFooterSegments(
	badges: PanelBadge[]
): Array<{ text: string; tone?: PanelBadgeTone }> {
	const segments: Array<{ text: string; tone?: PanelBadgeTone }> = [];
	for (let index = 0; index < badges.length; index += 1) {
		const badge = badges[index];
		if (!badge) {
			continue;
		}
		if (index > 0) {
			segments.push({ text: '  ' });
		}
		const badgeText = badge.framed === false ? badge.text : `[${badge.text}]`;
		segments.push(
			badge.tone ? { text: badgeText, tone: badge.tone } : { text: badgeText }
		);
	}
	return segments;
}

function footerToneColor(tone: PanelBadgeTone | undefined): string {
	if (tone === 'accent') {
		return cockpitTheme.accent;
	}
	if (tone === 'success') {
		return cockpitTheme.success;
	}
	if (tone === 'warning') {
		return cockpitTheme.warning;
	}
	if (tone === 'danger') {
		return cockpitTheme.danger;
	}
	return cockpitTheme.labelText;
}
