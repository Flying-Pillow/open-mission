/** @jsxImportSource @opentui/solid */

import type { InputRenderable } from '@opentui/core';
import { cockpitTheme } from './cockpitTheme.js';
import { Panel } from './Panel.js';
import type { FocusArea } from './types.js';

type PanelStyle = Record<string, string | number | undefined>;

type CommandDockProps = {
	title: string;
	focusArea: FocusArea;
	isRunningCommand: boolean;
	inputValue: string;
	placeholder: string;
	onInputChange: (value: string) => void;
	onInputSubmit: (value?: string) => void;
	style?: PanelStyle;
};

export function CommandDock(props: CommandDockProps) {
	let inputRef: InputRenderable | undefined;

	return (
		<Panel
			title={props.title}
			borderColor={props.focusArea === 'command' ? cockpitTheme.accent : cockpitTheme.border}
			style={{ height: 4, ...(props.style ?? {}) }}
			footerBadges={[
				{ text: props.isRunningCommand ? 'running' : 'idle', tone: props.isRunningCommand ? 'warning' : 'neutral' },
				{ text: props.focusArea === 'command' ? 'focused' : 'background', tone: props.focusArea === 'command' ? 'accent' : 'neutral' }
			]}
		>
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
				onSubmit={(value) => {
					props.onInputSubmit(inputRef?.value ?? (typeof value === 'string' ? value : props.inputValue));
				}}
			/>
		</Panel>
	);
}