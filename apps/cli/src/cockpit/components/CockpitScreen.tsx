/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from '@opentui/solid';
import type { PanelBadge } from './Panel.js';
import type { JSXElement } from 'solid-js';
import { Show } from 'solid-js';
import { HeaderPanel, type HeaderPanelTab } from './header/HeaderPanel.js';
import type { TabPanelLine } from './TabPanel.js';
import { CommandPanel } from './command/CommandPanel.js';
import type { CockpitKeyEvent, FocusArea } from './types.js';
import { KeyHintsRow } from './KeyHintsRow.js';
import type { ProgressRailItem } from './progressModels.js';
import { cockpitTheme } from './cockpitTheme.js';

const cockpitLayout = {
	headerHeight: 8,
	commandPanelHeight: 4,
	commandHelpHeight: 1
} as const;

const headerBodyRows = 3;

type CockpitScreenProps = {
	showHeader?: boolean;
	headerPanelTitle: string;
	title: string;
	headerTabs: HeaderPanelTab[];
	headerSelectedTabId: string | undefined;
	headerTabsFocusable: boolean;
	headerStatusLines: TabPanelLine[];
	headerFooterBadges: PanelBadge[];
	stageItems: ProgressRailItem[];
	focusArea: FocusArea;
	centerContent: JSXElement;
	overlayContent?: JSXElement;
	showCommandPanel: boolean;
	commandPanelTitle: string;
	commandPanelPlaceholder: string;
	commandPanelConfirmationPrompt?: string | undefined;
	commandPanelPrefix?: string | undefined;
	inputValue: string;
	isRunningCommand: boolean;
	commandHelp: string;
	keyHintsText: string;
	onHeaderMoveSelection?: (delta: number) => void;
	onHeaderMoveFocus?: (delta: number) => void;
	onHeaderSelect?: () => void;
	onInputChange: (value: string) => void;
	onInputSubmit: (value?: string) => void;
	onInputKeyDown?: (event: CockpitKeyEvent) => void;
};

export function CockpitScreen(props: CockpitScreenProps) {
	const terminal = useTerminalDimensions();
	const stackGap = 0;
	const footerCommandHelp = () => props.commandHelp;
	const commandPanelHeight = !props.showCommandPanel
		? 0
		: props.commandPanelConfirmationPrompt
		? 6
		: cockpitLayout.commandPanelHeight;
	const showHeader = props.showHeader ?? true;
	const headerHeight = 5 + headerBodyRows;
	const childCount = props.showCommandPanel ? 4 : 3;
	void terminal;
	void childCount;

	return (
		<box style={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minHeight: 0, padding: 1, gap: stackGap, backgroundColor: cockpitTheme.background }}>
			<Show when={showHeader}>
				<HeaderPanel
					panelTitle={props.headerPanelTitle}
					title={props.title}
					tabs={props.headerTabs}
					selectedTabId={props.headerSelectedTabId}
					tabsFocusable={props.headerTabsFocusable}
					focused={props.focusArea === 'header'}
					stageItems={props.stageItems}
					statusLines={props.headerStatusLines}
					footerBadges={props.headerFooterBadges}
					{...(props.onHeaderMoveSelection ? { onMoveSelection: props.onHeaderMoveSelection } : {})}
					{...(props.onHeaderMoveFocus ? { onMoveFocus: props.onHeaderMoveFocus } : {})}
					{...(props.onHeaderSelect ? { onSelectTab: props.onHeaderSelect } : {})}
					style={{ height: headerHeight, flexShrink: 0 }}
				/>
			</Show>

			<box style={{ flexDirection: 'row', flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0 }}>
				<box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0, gap: props.overlayContent ? 1 : 0 }}>
					<box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0 }}>
						{props.centerContent}
					</box>
					<Show when={props.overlayContent}>
						<box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, minWidth: 0 }}>
							{props.overlayContent}
						</box>
					</Show>
				</box>
			</box>

			<Show when={props.showCommandPanel}>
				<CommandPanel
					title={props.commandPanelTitle}
					focusArea={props.focusArea}
					isRunningCommand={props.isRunningCommand}
					{...(props.commandPanelPrefix
						? { commandPrefix: props.commandPanelPrefix }
						: {})}
					inputValue={props.inputValue}
					placeholder={props.commandPanelPlaceholder}
					{...(props.commandPanelConfirmationPrompt
						? { confirmationPrompt: props.commandPanelConfirmationPrompt }
						: {})}
					onInputChange={props.onInputChange}
					onInputSubmit={props.onInputSubmit}
					{...(props.onInputKeyDown ? { onInputKeyDown: props.onInputKeyDown } : {})}
					style={{ height: commandPanelHeight, flexShrink: 0 }}
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
	);
}