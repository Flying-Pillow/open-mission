/** @jsxImportSource @opentui/solid */

import { cockpitTheme } from './cockpitTheme.js';
import type { PanelBadge } from './Panel.js';
import { TabPanel, type TabPanelLine, type TabPanelTab } from './TabPanel.js';

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
	statusLines: string[];
	footerBadges: PanelBadge[];
	style?: PanelStyle;
};

export function CockpitHeader(props: CockpitHeaderProps) {
	const bodyLines: TabPanelLine[] = [
		{ text: props.title, fg: cockpitTheme.brightText },
		...props.statusLines.slice(0, 2).map((line) => ({ text: line, fg: cockpitTheme.metaText }))
	];
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
			bodyLines={bodyLines}
			bodyRows={3}
		/>
	);
}