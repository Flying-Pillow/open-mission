/** @jsxImportSource @opentui/solid */

import type { InputRenderable } from '@opentui/core';
import { cockpitTheme } from '../cockpitTheme.js';
import { Panel } from '../Panel.js';
import type { CockpitKeyEvent } from '../types.js';

type FlowInputPanelProps = {
	title: string;
	helperText: string;
	placeholder: string;
	inputValue: string;
	focused: boolean;
	isRunning: boolean;
	onInputChange: (value: string) => void;
	onInputSubmit: (value?: string) => void;
	onInputKeyDown?: (event: CockpitKeyEvent) => void;
};

export function FlowInputPanel(props: FlowInputPanelProps) {
	let inputRef: InputRenderable | undefined;

	return (
		<Panel
			title={props.title}
			borderColor={props.focused ? cockpitTheme.accent : cockpitTheme.border}
			style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}
			contentStyle={{ flexGrow: 1, flexShrink: 1, minHeight: 0, gap: 1 }}
			footerBadges={[
				{ text: 'flow' },
				{ text: props.focused ? 'focused' : 'background', tone: props.focused ? 'accent' : 'neutral' }
			]}
		>
			<text style={{ fg: cockpitTheme.secondaryText }}>{props.helperText}</text>
			<box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, flexDirection: 'column', justifyContent: 'center' }}>
				<input
					ref={(value) => {
						inputRef = value;
					}}
					focused={props.focused}
					width="100%"
					placeholder={props.isRunning ? 'Running...' : props.placeholder}
					value={props.inputValue}
					onChange={(value) => {
						props.onInputChange(inputRef?.value ?? value);
					}}
					onKeyDown={(event) => {
						props.onInputKeyDown?.(event);
					}}
					onSubmit={(value) => {
						props.onInputSubmit(
							inputRef?.value ?? (typeof value === 'string' ? value : props.inputValue)
						);
					}}
				/>
			</box>
		</Panel>
	);
}