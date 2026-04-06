/** @jsxImportSource @opentui/solid */

import { For, createMemo } from 'solid-js';
import type { ConsolePanelContent } from './ConsolePanel.js';
import { cockpitTheme } from './cockpitTheme.js';
import { Panel, type PanelBodyLine } from './Panel.js';

type ConsoleContentPanelProps = {
	focused: boolean;
	title: string;
	content: ConsolePanelContent;
	bodyRows?: number;
	contentWidth: number;
};

export function ConsoleContentPanel(props: ConsoleContentPanelProps) {
	const bodyLines = createMemo<PanelBodyLine[]>(() => {
		if (props.content.kind === 'markdown') {
			if (props.content.status === 'loading') {
				return [{ text: 'Loading markdown...', fg: cockpitTheme.secondaryText }];
			}
			if (props.content.status === 'error') {
				return [{ text: props.content.error ?? 'Unable to load markdown.', fg: cockpitTheme.danger }];
			}
			if (!props.content.markdown) {
				return [{ text: props.content.emptyLabel, fg: cockpitTheme.secondaryText }];
			}
			const lines = formatMarkdownLines(props.content.markdown);
			return lines.length > 0 ? lines : [{ text: props.content.emptyLabel, fg: cockpitTheme.secondaryText }];
		}
		if (props.content.lines.length === 0) {
			return [{ text: props.content.emptyLabel, fg: cockpitTheme.secondaryText }];
		}
		return props.content.lines.map((line) => ({ text: line, fg: cockpitTheme.bodyText }));
	});
	const stickyToBottom = createMemo(() => props.content.kind === 'output');

	return (
		<Panel
			title={props.title}
			titleColor={cockpitTheme.title}
			borderColor={props.focused ? cockpitTheme.accent : cockpitTheme.border}
			contentWidth={props.contentWidth}
			style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}
			contentStyle={
				typeof props.bodyRows === 'number'
					? {
						flexGrow: 1,
						flexShrink: 1,
						minHeight: props.bodyRows,
						maxHeight: props.bodyRows,
						height: props.bodyRows
					}
					: {
						flexGrow: 1,
						flexShrink: 1,
						minHeight: 0
					}
			}
		>
			<scrollbox
				focused={props.focused}
				stickyScroll={stickyToBottom()}
				{...(stickyToBottom() ? { stickyStart: 'bottom' as const } : {})}
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
				<box style={{ flexDirection: 'column' }}>
					<For each={bodyLines()}>
						{(line) => (
							<box
								style={{
									flexDirection: 'row',
									backgroundColor: line.backgroundColor ?? cockpitTheme.panelBackground
								}}
							>
								<text style={{ fg: line.fg ?? cockpitTheme.bodyText }}>
									{fitConsoleRow(line.text, props.contentWidth)}
								</text>
							</box>
						)}
					</For>
				</box>
			</scrollbox>
		</Panel>
	);
}

function fitConsoleRow(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const clipped = text.slice(0, safeWidth);
	return clipped.padEnd(safeWidth, ' ');
}

function formatMarkdownLines(markdown: string): Array<{ text: string; fg: string }> {
	const lines = markdown.split(/\r?\n/u);
	const rendered: Array<{ text: string; fg: string }> = [];
	let inCodeBlock = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('```')) {
			inCodeBlock = !inCodeBlock;
			rendered.push({ text: trimmed, fg: cockpitTheme.labelText });
			continue;
		}
		if (inCodeBlock) {
			rendered.push({ text: line, fg: cockpitTheme.metaText });
			continue;
		}
		if (/^###\s+/u.test(line)) {
			rendered.push({ text: line.replace(/^###\s+/u, ''), fg: cockpitTheme.primaryText });
			continue;
		}
		if (/^##\s+/u.test(line)) {
			rendered.push({ text: line.replace(/^##\s+/u, ''), fg: cockpitTheme.accent });
			continue;
		}
		if (/^#\s+/u.test(line)) {
			rendered.push({ text: line.replace(/^#\s+/u, ''), fg: cockpitTheme.brightText });
			continue;
		}
		if (/^>\s*/u.test(line)) {
			rendered.push({ text: line, fg: cockpitTheme.labelText });
			continue;
		}
		if (/^\s*[-*]\s+/u.test(line)) {
			rendered.push({ text: line.replace(/^\s*[-*]\s+/u, '• '), fg: cockpitTheme.bodyText });
			continue;
		}
		rendered.push({ text: line, fg: cockpitTheme.bodyText });
	}

	return rendered;
}
