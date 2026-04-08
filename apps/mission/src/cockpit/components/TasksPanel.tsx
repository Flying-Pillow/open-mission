/** @jsxImportSource @opentui/solid */

import { For, Show } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { Panel } from './Panel.js';

type TasksPanelProps = {
	lines: string[];
};

export function TasksPanel(props: TasksPanelProps) {
	return (
		<Panel title="TASKS" style={{ flexGrow: 1 }}>
			<Show when={props.lines.length > 0} fallback={<text style={{ fg: cockpitTheme.secondaryText }}>No active or ready tasks.</text>}>
				<For each={props.lines}>{(line) => <text style={{ fg: cockpitTheme.bodyText }}>{line}</text>}</For>
			</Show>
		</Panel>
	);
}