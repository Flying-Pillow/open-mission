/** @jsxImportSource @opentui/solid */

import { createMemo } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { TabPanel, type TabPanelLine, type TabPanelTab } from './TabPanel.js';

export type ConsoleTabKind = 'artifact' | 'task' | 'session' | 'daemon';

export type ConsolePanelTab = {
	id: string;
	label: string;
	kind: ConsoleTabKind;
};

export type ConsolePanelContent =
	| {
		kind: 'markdown';
		status: 'loading' | 'ready' | 'error';
		markdown?: string;
		emptyLabel: string;
		error?: string;
	  }
	| {
		kind: 'output';
		lines: string[];
		emptyLabel: string;
	  };

type ConsolePanelProps = {
	focused: boolean;
	tabs: ConsolePanelTab[];
	selectedTabId: string | undefined;
	content: ConsolePanelContent;
	bodyRows: number;
	onTabSelect: (tabId: string) => void;
};

export function ConsolePanel(props: ConsolePanelProps) {
	const bodyLines = createMemo<TabPanelLine[]>(() => {
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
	const panelTabs = createMemo<TabPanelTab[]>(() =>
		props.tabs.map((tab) => ({
			id: tab.id,
			label: tab.label,
			labelColor: tabLabelColor(tab.kind)
		}))
	);

	return (
		<TabPanel
			focused={props.focused}
			tabs={panelTabs()}
			selectedTabId={props.selectedTabId}
			tabsFocusable={props.tabs.length > 1}
			bodyLines={bodyLines()}
			bodyRows={props.bodyRows}
		/>
	);
}

function tabLabelColor(kind: ConsoleTabKind): string {
	if (kind === 'artifact') {
		return cockpitTheme.accent;
	}
	if (kind === 'task') {
		return cockpitTheme.warning;
	}
	if (kind === 'session') {
		return cockpitTheme.success;
	}
	return cockpitTheme.metaText;
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