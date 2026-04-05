/** @jsxImportSource @opentui/solid */

import type { InputRenderable } from '@opentui/core';
import { Show } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { Panel } from './Panel.js';
import type { FocusArea } from './types.js';

type PanelStyle = Record<string, string | number | undefined>;

export type CommandToolbarItem = {
	id: string;
	label: string;
	enabled: boolean;
	reason?: string;
	requiresConfirmation?: boolean;
	confirmationPrompt?: string;
};

type CommandDockProps = {
	title: string;
	focusArea: FocusArea;
	isRunningCommand: boolean;
	mode: 'input' | 'toolbar';
	inputValue: string;
	placeholder: string;
	toolbarItems: CommandToolbarItem[];
	selectedToolbarItemId: string | undefined;
	confirmingToolbarItemId: string | undefined;
	confirmationChoice: 'confirm' | 'cancel';
	onInputChange: (value: string) => void;
	onInputSubmit: (value?: string) => void;
	onInputKeyDown?: (event: {
		name?: string;
		preventDefault: () => void;
		stopPropagation: () => void;
	}) => void;
	style?: PanelStyle;
};

export function CommandDock(props: CommandDockProps) {
	let inputRef: InputRenderable | undefined;
	const mode = props.mode;
	const selectedToolbarItem = () =>
		props.toolbarItems.find((item) => item.id === props.selectedToolbarItemId);
	const confirmingToolbarItem = () =>
		props.toolbarItems.find((item) => item.id === props.confirmingToolbarItemId);

	const confirmLine = () => {
		const command = confirmingToolbarItem();
		if (!command) {
			return '';
		}
		return command.confirmationPrompt ?? `Execute ${command.label}?`;
	};

	const hintLine = () => {
		if (props.confirmingToolbarItemId) {
			return 'Left/Right to choose, Enter/Space to confirm, Esc to cancel.';
		}
		if (props.toolbarItems.length === 0) {
			return 'No commands available for the selected target.';
		}
		const selected = selectedToolbarItem();
		if (!selected) {
			return 'No executable commands for this target.';
		}
		return 'Left/Right to choose command. Enter/Space opens confirmation.';
	};

	const showIdleBadge = () => !props.isRunningCommand;

	return (
		<Panel
			title={props.title}
			borderColor={props.focusArea === 'command' ? cockpitTheme.accent : cockpitTheme.border}
			style={{ height: 4, ...(props.style ?? {}) }}
			{...(showIdleBadge() ? { footerBadges: [{ text: 'idle', tone: 'neutral' as const }] } : {})}
		>
			<Show
				when={mode === 'input'}
				fallback={
					<box style={{ flexDirection: 'column', gap: 1 }}>
						<Show
							when={Boolean(props.confirmingToolbarItemId)}
							fallback={
								<box style={{ flexDirection: 'row' }}>
									<Show
										when={props.toolbarItems.length > 0}
										fallback={<text style={{ fg: cockpitTheme.mutedText }}>No commands available for current target.</text>}
									>
										{props.toolbarItems.map((item) => {
											const isSelected = item.id === props.selectedToolbarItemId;
											const fg = item.enabled
												? isSelected
													? cockpitTheme.background
													: cockpitTheme.primaryText
												: cockpitTheme.mutedText;
											const bg = isSelected && item.enabled ? cockpitTheme.accent : cockpitTheme.panelBackground;
											return <text style={{ fg, bg }}>{` ${item.label} `}</text>;
										})}
									</Show>
								</box>
							}
						>
							<text>{confirmLine()}</text>
							<box style={{ flexDirection: 'row' }}>
								{(() => {
									const confirmSelected = props.confirmationChoice !== 'cancel';
									const confirmFg = confirmSelected ? cockpitTheme.background : cockpitTheme.primaryText;
									const confirmBg = confirmSelected ? cockpitTheme.accent : cockpitTheme.panelBackground;
									const cancelFg = !confirmSelected ? cockpitTheme.background : cockpitTheme.primaryText;
									const cancelBg = !confirmSelected ? cockpitTheme.accent : cockpitTheme.panelBackground;
									return (
										<>
											<text style={{ fg: confirmFg, bg: confirmBg }}> YES, CONFIRM </text>
											<text style={{ fg: cancelFg, bg: cancelBg }}> CANCEL </text>
										</>
									);
								})()}
							</box>
						</Show>
						<text style={{ fg: cockpitTheme.mutedText }}>{hintLine()}</text>
					</box>
				}
			>
				<box style={{ flexDirection: 'column' }}>
					<input
						ref={(value) => {
							inputRef = value;
						}}
						focused={props.focusArea === 'command'}
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
			</Show>
		</Panel>
	);
}