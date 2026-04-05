/** @jsxImportSource @opentui/solid */

import { For, Show } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { progressConnectorTone, progressStateTone } from './progressStateTone.js';

export type ProgressRailItemState = 'done' | 'active' | 'blocked' | 'pending';

export type ProgressRailItem = {
	id: string;
	label: string;
	state: ProgressRailItemState;
	selected: boolean;
	subtitle?: string;
};

type ProgressRailProps = {
	title: string;
	items: ProgressRailItem[];
	focused: boolean;
	emptyLabel: string;
};

export function ProgressRail(props: ProgressRailProps) {
	return (
		<box style={{ flexDirection: 'column', paddingLeft: 1, paddingRight: 1, gap: 1 }}>
			<text style={{ fg: props.focused ? cockpitTheme.accent : cockpitTheme.labelText }}>{props.title}</text>
			<Show when={props.items.length > 0} fallback={<text style={{ fg: cockpitTheme.secondaryText }}>{props.emptyLabel}</text>}>
				<box style={{ flexDirection: 'row', gap: 1 }}>
					<For each={props.items}>
						{(item, index) => (
							<box style={{ flexDirection: 'column', flexGrow: 1 }}>
								<box style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
									<text style={{ fg: markerColor(item.state, item.selected) }}>{marker(item.state, item.selected)}</text>
									<Show when={index() < props.items.length - 1}>
										<text style={{ fg: connectorColor(item.state) }}>━━━━━</text>
									</Show>
								</box>
								<text style={{ fg: item.selected ? cockpitTheme.brightText : labelColor(item.state) }}>{item.label}</text>
								<Show when={item.subtitle}>
									<text style={{ fg: cockpitTheme.mutedText }}>{item.subtitle}</text>
								</Show>
							</box>
						)}
					</For>
				</box>
			</Show>
			<box style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
				<text style={{ fg: cockpitTheme.labelText }}>[{String(props.items.length)} items]</text>
				<text style={{ fg: cockpitTheme.labelText }}>  </text>
				<text style={{ fg: props.focused ? cockpitTheme.accent : cockpitTheme.labelText }}>[{props.focused ? 'focused' : 'idle'}]</text>
			</box>
		</box>
	);
}

function marker(state: ProgressRailItemState, selected: boolean): string {
	if (selected) {
		return '◉';
	}
	if (state === 'done') {
		return '●';
	}
	if (state === 'active') {
		return '◍';
	}
	if (state === 'blocked') {
		return '◌';
	}
	return '○';
}

function markerColor(state: ProgressRailItemState, selected: boolean): string {
	if (selected) {
		return cockpitTheme.accent;
	}
	return labelColor(state);
}

function labelColor(state: ProgressRailItemState): string {
	return progressStateTone(state);
}

function connectorColor(state: ProgressRailItemState): string {
	return progressConnectorTone(state);
}