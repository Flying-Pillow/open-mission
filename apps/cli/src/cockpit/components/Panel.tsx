/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from '@opentui/solid';
import { For, Show, createMemo, type ParentProps } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';

type PanelStyle = Record<string, string | number | undefined>;

export type PanelBadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export type PanelBadge = {
	text: string;
	tone?: PanelBadgeTone;
	framed?: boolean;
};

export type PanelBodyLine = {
	text: string;
	fg?: string;
	backgroundColor?: string;
};

type PanelProps = ParentProps<{
	title?: string;
	titleColor?: string;
	border?: boolean;
	borderColor?: string;
	backgroundColor?: string;
	footerBadges?: PanelBadge[];
	bodyLines?: PanelBodyLine[];
	bodyRows?: number;
	contentWidth?: number;
	style?: PanelStyle;
	contentStyle?: PanelStyle;
}>;

export function Panel(props: PanelProps) {
	const terminal = useTerminalDimensions();
	const resolvedContentWidth = createMemo(() => {
		if (typeof props.contentWidth === 'number') {
			return Math.max(1, Math.floor(props.contentWidth));
		}
		return Math.max(1, terminal().width - 8);
	});
	const renderedBodyLines = createMemo<PanelBodyLine[]>(() => {
		const rows = Math.max(0, props.bodyRows ?? 0);
		const source = props.bodyLines ?? [];
		if (rows === 0) {
			return source;
		}
		const clipped = source.slice(0, rows);
		const padded = [...clipped];
		while (padded.length < rows) {
			padded.push({ text: '' });
		}
		return padded;
	});
	const hasBodyLines = createMemo(() => renderedBodyLines().length > 0);

	return (
		<box
			border={props.border ?? true}
			borderStyle="rounded"
			{...(props.border === false || !props.title ? {} : { title: props.title, titleAlignment: 'left' as const })}
			style={{
				flexDirection: 'column',
				flexShrink: 1,
				minHeight: 0,
				minWidth: 0,
				paddingTop: props.border === false ? 0 : 1,
				paddingBottom: 0,
				paddingLeft: 1,
				paddingRight: 1,
				borderColor: props.borderColor ?? cockpitTheme.border,
				backgroundColor: props.backgroundColor ?? cockpitTheme.panelBackground,
				...(props.style ?? {})
			}}
		>
			{props.border === false && props.title ? <text style={{ fg: props.titleColor ?? cockpitTheme.labelText }}>{props.title}</text> : null}
			<box
				style={{
					flexDirection: 'column',
					flexShrink: 1,
					minHeight: 0,
					minWidth: 0,
					paddingTop: 0,
					paddingBottom: props.footerBadges?.length ? 0 : props.border === false ? 0 : 1,
					...(props.contentStyle ?? {})
				}}
			>
				<Show
					when={hasBodyLines()}
					fallback={props.children}
				>
					<For each={renderedBodyLines()}>
						{(line) => (
							<box
								style={{
									flexDirection: 'row',
									backgroundColor: line.backgroundColor ?? cockpitTheme.panelBackground
								}}
							>
								<text style={{ fg: line.fg ?? cockpitTheme.bodyText }}>
									{fitPanelRow(line.text, resolvedContentWidth())}
								</text>
							</box>
						)}
					</For>
				</Show>
			</box>
			<Show when={props.footerBadges && props.footerBadges.length > 0}>
				<box
					style={{
						flexDirection: 'row',
						justifyContent: 'flex-end',
						paddingTop: 0,
						paddingRight: props.border === false ? 0 : 1,
						...(props.border === false ? {} : { marginBottom: -1 })
					}}
				>
					<For each={renderBadgeLine(props.footerBadges ?? [])}>
						{(segment) => <text style={{ fg: badgeColor(segment.tone) }}>{segment.text}</text>}
					</For>
				</box>
			</Show>
		</box>
	);
}

function fitPanelRow(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const clipped = text.slice(0, safeWidth);
	return clipped.padEnd(safeWidth, ' ');
}

function renderBadgeLine(badges: PanelBadge[]): Array<{ text: string; tone?: PanelBadgeTone }> {
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
		segments.push({ text: badgeText, ...(badge.tone ? { tone: badge.tone } : {}) });
	}
	return segments;
}

function badgeColor(tone: PanelBadgeTone | undefined): string {
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