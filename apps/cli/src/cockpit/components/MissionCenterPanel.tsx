/** @jsxImportSource @opentui/solid */

import { useTerminalDimensions } from '@opentui/solid';
import type { JSXElement } from 'solid-js';
import { createMemo } from 'solid-js';
import type { ConsolePanelContent } from './ConsolePanel.js';
import { ConsoleContentPanel } from './ConsoleContentPanel.js';

type MissionCenterPanelProps = {
	treePanel: JSXElement;
	consoleTitle: string;
	consoleContent: ConsolePanelContent;
	treeFocused: boolean;
	consoleFocused: boolean;
	consoleBodyRows: number;
};

const MIN_FLIGHT_DECK_WIDTH = 24;
const MAX_FLIGHT_DECK_WIDTH = 36;

export function MissionCenterPanel(props: MissionCenterPanelProps) {
	const terminal = useTerminalDimensions();
	const centerWidth = createMemo(() => Math.max(terminal().width - 4, 40));
	const flightDeckWidth = createMemo(() => {
		const targetWidth = Math.floor(centerWidth() * 0.25);
		return Math.min(Math.max(targetWidth, MIN_FLIGHT_DECK_WIDTH), MAX_FLIGHT_DECK_WIDTH);
	});
	const consoleWidth = createMemo(() => Math.max(centerWidth() - flightDeckWidth() - 1, 12));
	const consoleContentWidth = createMemo(() => Math.max(consoleWidth() - 6, 8));

	return (
		<box style={{ flexDirection: 'row', flexGrow: 1, flexShrink: 1, minHeight: 0, gap: 1 }}>
			<box
				style={{
					width: flightDeckWidth(),
					minWidth: flightDeckWidth(),
					maxWidth: flightDeckWidth(),
					flexGrow: 0,
					flexShrink: 0,
					minHeight: 0
				}}
			>
				{props.treePanel}
			</box>
			<box
				style={{
					width: consoleWidth(),
					minWidth: consoleWidth(),
					maxWidth: consoleWidth(),
					flexGrow: 0,
					flexShrink: 0,
					minHeight: 0
				}}
			>
				<ConsoleContentPanel
					focused={props.consoleFocused}
					title={props.consoleTitle}
					content={props.consoleContent}
					bodyRows={props.consoleBodyRows}
					contentWidth={consoleContentWidth()}
				/>
			</box>
		</box>
	);
}