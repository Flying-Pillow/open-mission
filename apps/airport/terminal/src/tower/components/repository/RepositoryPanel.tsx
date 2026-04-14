/** @jsxImportSource @opentui/solid */

import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { For, Show, createMemo } from 'solid-js';
import { Panel } from '../Panel.js';
import { towerTheme } from '../towerTheme.js';
import type { SelectItem, TowerKeyEvent } from '../types.js';

type RepositoryPanelProps = {
	items: SelectItem[];
	selectedItemId: string | undefined;
	focused: boolean;
	onMoveSelection: (delta: number) => void;
	onActivateSelection: (itemId: string | undefined) => void;
	onItemChange: (itemId: string) => void;
	onFocusCommand?: () => void;
};

export function RepositoryPanel(props: RepositoryPanelProps) {
	const terminal = useTerminalDimensions();
	const visibleItems = createMemo(() => props.items);
	const selectedItem = createMemo(() =>
		visibleItems().find((item) => item.id === props.selectedItemId)
	);
	const contentWidth = createMemo(() => {
		const terminalWidth = terminal().width;
		const normalizedTerminalWidth = Number.isFinite(terminalWidth)
			? Math.floor(terminalWidth)
			: 0;
		return Math.max(normalizedTerminalWidth - 8, 24);
	});
	const columnWidths = createMemo(() => splitOptionColumns(contentWidth()));
	const summaryLineWidth = createMemo(() => Math.max(12, contentWidth()));

	useKeyboard((event) => {
		if (!props.focused) {
			return;
		}
		handleRepositorySelectionKeyDown(event, props);
	});

	return (
		<Panel
			title="REPOSITORY SELECTION"
			borderColor={props.focused ? towerTheme.accent : towerTheme.border}
			style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}
			contentStyle={{ flexGrow: 1, minHeight: 0, gap: 1 }}
			footerBadges={[
				{ text: `${String(props.items.length)} options` },
				{ text: props.focused ? 'focused' : 'background', tone: props.focused ? 'accent' : 'neutral' }
			]}
		>
			<Show when={props.items.length > 0} fallback={<text style={{ fg: towerTheme.secondaryText }}>No missions or GitHub issues are available right now.</text>}>
				<text style={{ fg: towerTheme.secondaryText }}>
					Choose an active mission, pick an open issue that is not already active, or start a new mission.
				</text>
				<text style={{ fg: towerTheme.secondaryText }}>{' '}</text>
				<text style={{ fg: towerTheme.brightText }}>
					{fitCell(selectedItem()?.label ?? 'No option selected', summaryLineWidth(), false)}
				</text>
				<text style={{ fg: towerTheme.secondaryText }}>
					{fitCell(selectedItem()?.description ?? 'No missions or GitHub issues are available right now.', summaryLineWidth(), false)}
				</text>

				<box style={{ flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
					<For each={visibleItems()}>
						{(item) => (
							<RepositorySelectionRow
								item={item}
								selected={item.id === props.selectedItemId}
								columnWidths={columnWidths()}
							/>
						)}
					</For>
				</box>
			</Show>
		</Panel>
	);
}

function RepositorySelectionRow(props: {
	item: SelectItem;
	selected: boolean;
	columnWidths: [number, number];
}) {
	const sectionTitleColor = '#93c5fd';
	const isSeparator = props.item.id.startsWith('separator:');
	const isSectionTitle = props.item.id.startsWith('section:');
	const fullWidth = props.columnWidths[0] + props.columnWidths[1] + 3;
	const baseBackground = props.selected ? towerTheme.accentSoft : towerTheme.panelBackground;

	if (isSeparator) {
		return (
			<box style={{ flexDirection: 'row', backgroundColor: baseBackground }}>
				<text style={{ fg: towerTheme.mutedText }}>{' '.repeat(Math.max(1, fullWidth))}</text>
			</box>
		);
	}

	if (isSectionTitle) {
		return (
			<box style={{ flexDirection: 'row', backgroundColor: baseBackground }}>
				<text style={{ fg: sectionTitleColor }}>{fitCell(props.item.label, fullWidth, false)}</text>
			</box>
		);
	}

	const leftCell = fitCell(props.item.label, props.columnWidths[0], true);
	const rightCell = fitCell(props.item.description, props.columnWidths[1], false);
	return (
		<box style={{ flexDirection: 'row', backgroundColor: baseBackground }}>
			<text style={{ fg: props.selected ? towerTheme.primaryText : towerTheme.bodyText }}>{leftCell}</text>
			<text style={{ fg: props.selected ? towerTheme.primaryText : towerTheme.mutedText }}>{' | '}</text>
			<text style={{ fg: props.selected ? towerTheme.primaryText : towerTheme.secondaryText }}>{rightCell}</text>
		</box>
	);
}

function splitOptionColumns(totalWidth: number): [number, number] {
	const gutterWidth = 3;
	const innerWidth = Math.max(10, totalWidth - gutterWidth);
	const leftWidth = Math.max(10, Math.floor(innerWidth * 0.42));
	const rightWidth = Math.max(8, innerWidth - leftWidth);
	return [leftWidth, rightWidth];
}

function fitCell(value: string, width: number, padEndValue: boolean): string {
	const trimmed = value.trim();
	if (width <= 0) {
		return '';
	}
	if (trimmed.length <= width) {
		return padEndValue ? trimmed.padEnd(width, ' ') : trimmed;
	}
	if (width <= 3) {
		return trimmed.slice(0, width);
	}
	return `${trimmed.slice(0, width - 3)}...`;
}

function handleRepositorySelectionKeyDown(
	event: TowerKeyEvent,
	props: RepositoryPanelProps
): void {
	if (event.name === 'up') {
		event.preventDefault();
		event.stopPropagation();
		props.onMoveSelection(-1);
		return;
	}
	if (event.name === 'down') {
		event.preventDefault();
		event.stopPropagation();
		props.onMoveSelection(1);
		return;
	}
	if (event.name === 'enter' || event.name === 'return') {
		event.preventDefault();
		event.stopPropagation();
		props.onActivateSelection(props.selectedItemId);
		return;
	}
	if (event.name === 'right') {
		event.preventDefault();
		event.stopPropagation();
		props.onFocusCommand?.();
	}
}
