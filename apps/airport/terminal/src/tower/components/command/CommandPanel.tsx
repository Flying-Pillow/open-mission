/** @jsxImportSource @opentui/solid */

import type { InputRenderable, SelectOption } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { Show } from 'solid-js';
import { towerTheme } from '../towerTheme.js';
import { Panel } from '../Panel.js';
import type { CommandItem, TowerKeyEvent, FocusArea } from '../types.js';

type PanelStyle = Record<string, string | number | undefined>;

type CommandPanelProps = {
	title: string;
	focusArea: FocusArea;
	isRunningCommand: boolean;
	commandPrefix?: string | undefined;
	inputValue: string;
	placeholder: string;
	confirmationPrompt?: string | undefined;
	showCommandPicker: boolean;
	commandPickerItems: CommandItem[];
	selectedCommandPickerItemId: string | undefined;
	onInputChange: (value: string) => void;
	onInputSubmit: (value?: string) => void;
	onInputKeyDown?: (event: TowerKeyEvent) => void;
	onCommandPickerHighlight?: (itemId: string) => void;
	onCommandPickerSelect?: (itemId: string) => void;
	onCommandPickerKeyDown?: (event: TowerKeyEvent) => void;
	style?: PanelStyle;
};

export function CommandPanel(props: CommandPanelProps) {
	let inputRef: InputRenderable | undefined;
	const terminal = useTerminalDimensions();
	const commandPickerTotalWidth = () => {
		const terminalWidth = terminal().width;
		const normalizedTerminalWidth = Number.isFinite(terminalWidth)
			? Math.floor(terminalWidth)
			: 0;
		return Math.max(24, normalizedTerminalWidth - 10);
	};
	const commandFocused = () => props.focusArea === 'command';
	const pickerFocused = () => commandFocused() && props.showCommandPicker;
	const inputFocused = () => commandFocused() && !props.showCommandPicker;
	const pickerOptions = () => {
		const [commandWidth, descriptionWidth] = splitOptionColumns(commandPickerTotalWidth());
		return props.commandPickerItems.map<SelectOption>((item) => ({
			name: formatOptionLine(item.command, item.description, commandWidth, descriptionWidth),
			description: '',
			value: item.id,
		}));
	};
	const selectedPickerIndex = () => {
		if (props.commandPickerItems.length === 0) {
			return 0;
		}
		const index = props.commandPickerItems.findIndex((item) => item.id === props.selectedCommandPickerItemId);
		return index >= 0 ? index : 0;
	};

	const showIdleBadge = () => !props.isRunningCommand;

	return (
		<Panel
			title={props.title}
			borderColor={commandFocused() ? towerTheme.accent : towerTheme.border}
			style={{ ...(props.style ?? {}) }}
			{...(showIdleBadge() ? { footerBadges: [{ text: 'idle', tone: 'neutral' as const }] } : {})}
		>
			<box style={{ flexDirection: 'column', gap: 1 }}>
				<box style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
					<Show when={props.commandPrefix}>
						<text
							style={{
								fg: towerTheme.brightText,
								bg: towerTheme.accentSoft
							}}
						>
							{` ${props.commandPrefix} `}
						</text>
					</Show>
					<box style={{ flexGrow: 1 }}>
						<input
							ref={(value) => {
								inputRef = value;
							}}
							focused={inputFocused()}
							width="100%"
							placeholder={props.isRunningCommand ? 'Running...' : props.placeholder}
							value={props.inputValue}
							onChange={(value) => {
								props.onInputChange(inputRef?.value ?? value);
							}}
							onKeyDown={(event) => {
								props.onInputKeyDown?.(event);
							}}
							onSubmit={(value) => {
								props.onInputSubmit(inputRef?.value ?? (typeof value === 'string' ? value : props.inputValue));
							}}
						/>
					</box>
				</box>
				{props.confirmationPrompt ? (
					<text style={{ fg: towerTheme.mutedText }}>{props.confirmationPrompt}</text>
				) : null}
				<Show when={props.showCommandPicker && props.commandPickerItems.length > 0}>
					<box style={{ height: Math.min(8, props.commandPickerItems.length), minHeight: 1, flexGrow: 1 }}>
						<select
							focused={pickerFocused()}
							height="100%"
							width="100%"
							options={pickerOptions()}
							selectedIndex={selectedPickerIndex()}
							backgroundColor={towerTheme.panelBackground}
							textColor={towerTheme.bodyText}
							focusedBackgroundColor={towerTheme.panelBackground}
							focusedTextColor={towerTheme.primaryText}
							selectedBackgroundColor={towerTheme.accentSoft}
							selectedTextColor={towerTheme.brightText}
							descriptionColor={towerTheme.secondaryText}
							selectedDescriptionColor={towerTheme.primaryText}
							showDescription={false}
							onKeyDown={(event) => {
								props.onCommandPickerKeyDown?.(event);
							}}
							onChange={(_index, option) => {
								props.onCommandPickerHighlight?.(String(option?.value ?? ''));
							}}
							onSelect={(_index, option) => {
								props.onCommandPickerSelect?.(String(option?.value ?? ''));
							}}
						/>
					</box>
				</Show>
				<Show when={props.showCommandPicker && props.commandPickerItems.length === 0}>
					<text style={{ fg: towerTheme.secondaryText }}>No commands are available for the current selection.</text>
				</Show>
			</box>
		</Panel>
	);
}

function splitOptionColumns(totalWidth: number): [number, number] {
	const gutterWidth = 3;
	const innerWidth = Math.max(10, totalWidth - gutterWidth);
	const leftWidth = Math.max(14, Math.floor(innerWidth * 0.42));
	const rightWidth = Math.max(10, innerWidth - leftWidth);
	return [leftWidth, rightWidth];
}

function formatOptionLine(label: string, description: string, leftWidth: number, rightWidth: number): string {
	const leftCell = fitCell(label, leftWidth, true);
	const rightCell = fitCell(description, rightWidth, false);
	return `${leftCell} | ${rightCell}`;
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