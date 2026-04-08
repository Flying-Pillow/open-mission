/** @jsxImportSource @opentui/solid */

import type { InputRenderable } from '@opentui/core';
import { Show } from 'solid-js';
import { cockpitTheme } from '../cockpitTheme.js';
import { Panel } from '../Panel.js';
import type { CockpitKeyEvent, FocusArea } from '../types.js';

type PanelStyle = Record<string, string | number | undefined>;

type CommandPanelProps = {
	title: string;
	focusArea: FocusArea;
	isRunningCommand: boolean;
	commandPrefix?: string | undefined;
	inputValue: string;
	placeholder: string;
	confirmationPrompt?: string | undefined;
	onInputChange: (value: string) => void;
	onInputSubmit: (value?: string) => void;
	onInputKeyDown?: (event: CockpitKeyEvent) => void;
	style?: PanelStyle;
};

export function CommandPanel(props: CommandPanelProps) {
	let inputRef: InputRenderable | undefined;
	const commandFocused = () => props.focusArea === 'command';

	const showIdleBadge = () => !props.isRunningCommand;

	return (
		<Panel
			title={props.title}
			borderColor={commandFocused() ? cockpitTheme.accent : cockpitTheme.border}
			style={{ height: props.confirmationPrompt ? 6 : 4, ...(props.style ?? {}) }}
			{...(showIdleBadge() ? { footerBadges: [{ text: 'idle', tone: 'neutral' as const }] } : {})}
		>
			<box style={{ flexDirection: 'column', gap: 1 }}>
				<box style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
					<Show when={props.commandPrefix}>
						<text
							style={{
								fg: cockpitTheme.brightText,
								bg: cockpitTheme.accentSoft
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
							focused={commandFocused()}
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
					<text style={{ fg: cockpitTheme.mutedText }}>{props.confirmationPrompt}</text>
				) : null}
			</box>
		</Panel>
	);
}