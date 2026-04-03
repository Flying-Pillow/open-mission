/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from '@opentui/solid';
import type { PanelBadge } from './Panel.js';
import type { JSXElement } from 'solid-js';
import { Show } from 'solid-js';
import { CockpitHeader, type CockpitHeaderTab } from './CockpitHeader.js';
import { CommandDock } from './CommandDock.js';
import { ConsolePanel, type ConsolePanelContent, type ConsolePanelTab } from './ConsolePanel.js';
import type { FocusArea } from './types.js';
import { KeyHintsRow } from './KeyHintsRow.js';
import { ProgressRail, type ProgressRailItem } from './ProgressRail.js';
import { cockpitTheme } from './cockpitTheme.js';

const cockpitLayout = {
	headerHeight: 8,
	commandDockHeight: 4,
	commandHelpHeight: 1
} as const;

type CockpitScreenProps = {
	headerPanelTitle: string;
	title: string;
	headerTabs: CockpitHeaderTab[];
	headerSelectedTabId: string | undefined;
	headerTabsFocusable: boolean;
	headerStatusLines: string[];
	headerFooterBadges: PanelBadge[];
	expandedCommandPanel?: JSXElement;
	showProgressRails: boolean;
	stageItems: ProgressRailItem[];
	taskItems: ProgressRailItem[];
	focusArea: FocusArea;
	consoleTabs: ConsolePanelTab[];
	selectedConsoleTabId: string | undefined;
	consoleContent: ConsolePanelContent;
	onConsoleTabSelect: (tabId: string) => void;
	mainPanel?: JSXElement;
	commandDockTitle: string;
	commandDockPlaceholder: string;
	inputValue: string;
	isRunningCommand: boolean;
	commandHelp: string;
	onInputChange: (value: string) => void;
	onInputSubmit: (value?: string) => void;
};

export function CockpitScreen(props: CockpitScreenProps) {
	const terminal = useTerminalDimensions();
	const stackGap = 0;
	const expandedCommandPanelHeight = Math.max(
		terminal().height - (2 + cockpitLayout.headerHeight + cockpitLayout.commandHelpHeight),
		8
	);

	const progressRailsHeight = props.showProgressRails
		? estimateProgressRailHeight(props.stageItems) + estimateProgressRailHeight(props.taskItems)
		: 0;
	const childCount = props.showProgressRails ? 6 : 4;
	const gapRows = (childCount - 1) * stackGap;
	const mainPanelHeight = Math.max(
		terminal().height - (2 + cockpitLayout.headerHeight + progressRailsHeight + cockpitLayout.commandDockHeight + cockpitLayout.commandHelpHeight + gapRows),
		8
	);
	const consoleBodyRows = Math.max(mainPanelHeight - 5, 3);

	return (
		<Show
			when={props.expandedCommandPanel}
			fallback={
				<box style={{ flexDirection: 'column', flexGrow: 1, padding: 1, gap: stackGap, backgroundColor: cockpitTheme.background }}>
					<CockpitHeader
						panelTitle={props.headerPanelTitle}
						title={props.title}
						tabs={props.headerTabs}
						selectedTabId={props.headerSelectedTabId}
						tabsFocusable={props.headerTabsFocusable}
						focused={props.focusArea === 'header'}
						statusLines={props.headerStatusLines}
						footerBadges={props.headerFooterBadges}
						style={{ height: cockpitLayout.headerHeight, flexShrink: 0 }}
					/>

					{props.showProgressRails ? (
						<>
							<ProgressRail
								title="STAGES"
								items={props.stageItems}
								focused={props.focusArea === 'stages'}
								emptyLabel="No mission stage is available yet."
							/>

							<ProgressRail
								title="TASKS"
								items={props.taskItems}
								focused={props.focusArea === 'tasks'}
								emptyLabel="No tasks exist for the selected stage."
							/>
						</>
					) : null}

					{props.mainPanel ?? (
						<ConsolePanel
							focused={props.focusArea === 'sessions'}
							tabs={props.consoleTabs}
							selectedTabId={props.selectedConsoleTabId}
							content={props.consoleContent}
							bodyRows={consoleBodyRows}
							onTabSelect={props.onConsoleTabSelect}
						/>
					)}

					<CommandDock
						title={props.commandDockTitle}
						focusArea={props.focusArea}
						isRunningCommand={props.isRunningCommand}
						inputValue={props.inputValue}
						placeholder={props.commandDockPlaceholder}
						onInputChange={props.onInputChange}
						onInputSubmit={props.onInputSubmit}
						style={{ height: cockpitLayout.commandDockHeight, flexShrink: 0 }}
					/>

					<box
						style={{
							flexDirection: 'row',
							height: cockpitLayout.commandHelpHeight,
							paddingLeft: 1,
							paddingRight: 1,
							gap: 2,
							flexShrink: 0
						}}
					>
						<box style={{ flexGrow: 1 }}>
							<text style={{ fg: cockpitTheme.mutedText }}>{props.commandHelp}</text>
						</box>
						<KeyHintsRow />
					</box>
				</box>
			}
		>
			{(expandedCommandPanel) => {
				return (
					<box style={{ flexDirection: 'column', flexGrow: 1, padding: 1, gap: stackGap, backgroundColor: cockpitTheme.background }}>
						<CockpitHeader
							panelTitle={props.headerPanelTitle}
							title={props.title}
							tabs={props.headerTabs}
							selectedTabId={props.headerSelectedTabId}
							tabsFocusable={props.headerTabsFocusable}
							focused={props.focusArea === 'header'}
							statusLines={props.headerStatusLines}
							footerBadges={props.headerFooterBadges}
							style={{ height: cockpitLayout.headerHeight, flexShrink: 0 }}
						/>

						<box style={{ flexGrow: 1, minHeight: expandedCommandPanelHeight }}>
							{expandedCommandPanel()}
						</box>

						<box
							style={{
								flexDirection: 'row',
								height: cockpitLayout.commandHelpHeight,
								paddingLeft: 1,
								paddingRight: 1,
								gap: 2,
								flexShrink: 0
							}}
						>
							<box style={{ flexGrow: 1 }}>
								<text style={{ fg: cockpitTheme.mutedText }}>{props.commandHelp}</text>
							</box>
							<KeyHintsRow />
						</box>
					</box>
				);
			}}
		</Show>
	);
}

function estimateProgressRailHeight(items: ProgressRailItem[]): number {
	if (items.length === 0) {
		return 5;
	}
	const contentHeight = items.some((item) => Boolean(item.subtitle)) ? 3 : 2;
	return contentHeight + 4;
}