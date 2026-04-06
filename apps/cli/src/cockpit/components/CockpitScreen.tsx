/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from '@opentui/solid';
import type { PanelBadge } from './Panel.js';
import type { JSXElement } from 'solid-js';
import { Show } from 'solid-js';
import { CockpitHeader, type CockpitHeaderTab } from './CockpitHeader.js';
import type { TabPanelLine } from './TabPanel.js';
import { CommandDock } from './CommandDock.js';
import type { CommandToolbarItem } from './CommandDock.js';
import { ConsolePanel, type ConsolePanelContent, type ConsolePanelTab } from './ConsolePanel.js';
import { ConsoleContentPanel } from './ConsoleContentPanel.js';
import type { FocusArea } from './types.js';
import { KeyHintsRow } from './KeyHintsRow.js';
import type { ProgressRailItem } from './progressModels.js';
import { cockpitTheme } from './cockpitTheme.js';

const cockpitLayout = {
	headerHeight: 8,
	commandDockHeight: 4,
	commandHelpHeight: 1
} as const;

type CockpitScreenProps = {
	showHeader?: boolean;
	headerPanelTitle: string;
	title: string;
	headerTabs: CockpitHeaderTab[];
	headerSelectedTabId: string | undefined;
	headerTabsFocusable: boolean;
	headerStatusLines: TabPanelLine[];
	headerFooterBadges: PanelBadge[];
	expandedCommandPanel?: JSXElement;
	stageItems: ProgressRailItem[];
	focusArea: FocusArea;
	consoleTabs: ConsolePanelTab[];
	selectedConsoleTabId: string | undefined;
	consoleContent: ConsolePanelContent;
	rightPanelTitle: string;
	onConsoleTabSelect: (tabId: string) => void;
	missionTreePanel?: JSXElement;
	hideMissionTreePanel?: boolean;
	mainPanel?: JSXElement;
	commandDockTitle: string;
	commandDockPlaceholder: string;
	commandDockMode: 'input' | 'toolbar';
	toolbarItems: CommandToolbarItem[];
	selectedToolbarItemId: string | undefined;
	confirmingToolbarItemId: string | undefined;
	confirmationChoice: 'confirm' | 'cancel';
	inputValue: string;
	isRunningCommand: boolean;
	commandHelp: string;
	keyHintsText: string;
	onInputChange: (value: string) => void;
	onInputSubmit: (value?: string) => void;
	onInputKeyDown?: (event: {
		name?: string;
		preventDefault: () => void;
		stopPropagation: () => void;
	}) => void;
};

export function CockpitScreen(props: CockpitScreenProps) {
	const terminal = useTerminalDimensions();
	const stackGap = 0;
	const commandDockHeight = props.commandDockMode === 'toolbar'
		? (props.confirmingToolbarItemId ? 7 : 6)
		: cockpitLayout.commandDockHeight;
	const showHeader = props.showHeader ?? true;
	const headerBodyRows = 1 + Math.min(props.headerStatusLines.length, 1) + (props.stageItems.length > 0 ? 2 : 0);
	const headerHeight = 5 + headerBodyRows;
	const visibleHeaderHeight = showHeader ? headerHeight : 0;
	const expandedCommandPanelHeight = Math.max(
		terminal().height - (2 + visibleHeaderHeight + cockpitLayout.commandHelpHeight),
		8
	);
	const childCount = 4;
	const gapRows = (childCount - 1) * stackGap;
	const mainPanelHeight = Math.max(
		terminal().height - (2 + visibleHeaderHeight + commandDockHeight + cockpitLayout.commandHelpHeight + gapRows),
		8
	);
	const consoleBodyRows = Math.max(mainPanelHeight - 4, 3);
	const centerWidth = Math.max(terminal().width - 2, 20);
	const showMissionTreePanel = Boolean(props.missionTreePanel) && props.hideMissionTreePanel !== true;
	const treePaneWidth = showMissionTreePanel ? Math.max(Math.floor((centerWidth - 1) * 0.25), 20) : 0;
	const rightPaneWidth = showMissionTreePanel ? Math.max(centerWidth - treePaneWidth - 1, 12) : centerWidth;
	const rightContentWidth = Math.max(rightPaneWidth - 6, 8);

	return (
		<Show
			when={props.expandedCommandPanel}
			fallback={
				<box style={{ flexDirection: 'column', flexGrow: 1, padding: 1, gap: stackGap, backgroundColor: cockpitTheme.background }}>
					<Show when={showHeader}>
						<CockpitHeader
							panelTitle={props.headerPanelTitle}
							title={props.title}
							tabs={props.headerTabs}
							selectedTabId={props.headerSelectedTabId}
							tabsFocusable={props.headerTabsFocusable}
							focused={props.focusArea === 'header'}
							stageItems={props.stageItems}
							statusLines={props.headerStatusLines}
							footerBadges={props.headerFooterBadges}
							style={{ height: headerHeight, flexShrink: 0 }}
						/>
					</Show>

					<box style={{ flexGrow: 1, height: mainPanelHeight }}>
						<box style={{ flexDirection: 'row', flexGrow: 1, gap: showMissionTreePanel ? 1 : 0 }}>
							<Show when={props.missionTreePanel}>
								<box
									style={showMissionTreePanel
										? { flexGrow: 1, flexBasis: 0, minWidth: 20 }
										: { flexGrow: 0, flexBasis: 0, minWidth: 0, maxWidth: 0, width: 0 }}
								>
									{props.missionTreePanel}
								</box>
							</Show>
							<box style={{ flexGrow: showMissionTreePanel ? 3 : 1, flexBasis: 0 }}>
								{props.mainPanel ?? (
									<Show
										when={props.missionTreePanel}
										fallback={
											<ConsolePanel
												focused={props.focusArea === 'sessions'}
												tabs={props.consoleTabs}
												selectedTabId={props.selectedConsoleTabId}
												content={props.consoleContent}
												bodyRows={consoleBodyRows}
												onTabSelect={props.onConsoleTabSelect}
											/>
										}
									>
										<ConsoleContentPanel
											focused={props.focusArea === 'sessions'}
											title={props.rightPanelTitle}
											content={props.consoleContent}
											bodyRows={consoleBodyRows}
											contentWidth={rightContentWidth}
										/>
									</Show>
								)}
							</box>
						</box>
					</box>

					<CommandDock
						title={props.commandDockTitle}
						focusArea={props.focusArea}
						isRunningCommand={props.isRunningCommand}
						mode={props.commandDockMode}
						inputValue={props.inputValue}
						placeholder={props.commandDockPlaceholder}
						toolbarItems={props.toolbarItems}
						selectedToolbarItemId={props.selectedToolbarItemId}
						confirmingToolbarItemId={props.confirmingToolbarItemId}
						confirmationChoice={props.confirmationChoice}
						onInputChange={props.onInputChange}
						onInputSubmit={props.onInputSubmit}
						{...(props.onInputKeyDown ? { onInputKeyDown: props.onInputKeyDown } : {})}
						style={{ height: commandDockHeight, flexShrink: 0 }}
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
							<KeyHintsRow text={props.keyHintsText} />
					</box>
				</box>
			}
		>
			{(expandedCommandPanel) => {
				return (
					<box style={{ flexDirection: 'column', flexGrow: 1, padding: 1, gap: stackGap, backgroundColor: cockpitTheme.background }}>
						<Show when={showHeader}>
							<CockpitHeader
								panelTitle={props.headerPanelTitle}
								title={props.title}
								tabs={props.headerTabs}
								selectedTabId={props.headerSelectedTabId}
								tabsFocusable={props.headerTabsFocusable}
								focused={props.focusArea === 'header'}
								stageItems={props.stageItems}
								statusLines={props.headerStatusLines}
								footerBadges={props.headerFooterBadges}
								style={{ height: headerHeight, flexShrink: 0 }}
							/>
						</Show>

						<box style={{ flexGrow: 1, height: expandedCommandPanelHeight }}>
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
							<KeyHintsRow text={props.keyHintsText} />
						</box>
					</box>
				);
			}}
		</Show>
	);
}