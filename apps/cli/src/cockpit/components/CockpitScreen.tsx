/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from '@opentui/solid';
import type { PanelBadge } from './Panel.js';
import type { JSXElement } from 'solid-js';
import { Show } from 'solid-js';
import { CockpitHeader, type CockpitHeaderTab } from './CockpitHeader.js';
import type { TabPanelLine } from './TabPanel.js';
import { CommandDock } from './CommandDock.js';
import type { CommandToolbarItem } from './CommandDock.js';
import type { FocusArea } from './types.js';
import { KeyHintsRow } from './KeyHintsRow.js';
import type { ProgressRailItem } from './progressModels.js';
import { cockpitTheme } from './cockpitTheme.js';

const cockpitLayout = {
	headerHeight: 8,
	commandDockHeight: 4,
	commandHelpHeight: 1
} as const;

const headerBodyRows = 3;

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
	centerContent: JSXElement;
	overlayContent?: JSXElement;
	showCommandDock: boolean;
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
	const footerCommandHelp = () =>
		props.commandHelp.startsWith('Available: ') ? '' : props.commandHelp;
	const commandDockHeight = !props.showCommandDock
		? 0
		: props.commandDockMode === 'toolbar'
		? (props.confirmingToolbarItemId ? 7 : 6)
		: cockpitLayout.commandDockHeight;
	const showHeader = props.showHeader ?? true;
	const headerHeight = 5 + headerBodyRows;
	const childCount = props.showCommandDock ? 4 : 3;
	void terminal;
	void childCount;

	return (
		<Show
			when={props.expandedCommandPanel}
			fallback={
				<box style={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minHeight: 0, padding: 1, gap: stackGap, backgroundColor: cockpitTheme.background }}>
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

					<box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
						{props.overlayContent ?? props.centerContent}
					</box>

					<Show when={props.showCommandDock}>
						<CommandDock
							title={props.commandDockTitle}
							focusArea={props.focusArea}
							isRunningCommand={props.isRunningCommand}
							mode={props.commandDockMode}
							inputValue={props.inputValue}
							placeholder={props.commandDockPlaceholder}
							toolbarHint={props.commandHelp}
							toolbarItems={props.toolbarItems}
							selectedToolbarItemId={props.selectedToolbarItemId}
							confirmingToolbarItemId={props.confirmingToolbarItemId}
							confirmationChoice={props.confirmationChoice}
							onInputChange={props.onInputChange}
							onInputSubmit={props.onInputSubmit}
							{...(props.onInputKeyDown ? { onInputKeyDown: props.onInputKeyDown } : {})}
							style={{ height: commandDockHeight, flexShrink: 0 }}
						/>
					</Show>

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
							<text style={{ fg: cockpitTheme.mutedText }}>{footerCommandHelp()}</text>
						</box>
							<KeyHintsRow text={props.keyHintsText} />
					</box>
				</box>
			}
		>
			{(expandedCommandPanel) => {
				return (
					<box style={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minHeight: 0, padding: 1, gap: stackGap, backgroundColor: cockpitTheme.background }}>
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

						<box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
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
								<text style={{ fg: cockpitTheme.mutedText }}>{footerCommandHelp()}</text>
							</box>
							<KeyHintsRow text={props.keyHintsText} />
						</box>
					</box>
				);
			}}
		</Show>
	);
}