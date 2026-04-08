/** @jsxImportSource @opentui/solid */

import { For, Show } from 'solid-js';
import { cockpitTheme } from '../cockpitTheme.js';
import { Panel } from '../Panel.js';

export type FlowSummaryItem = {
	label: string;
	value: string;
};

type FlowSummaryPanelProps = {
	title: string;
	stepLabel: string;
	helperText: string;
	items: FlowSummaryItem[];
	focused: boolean;
};

export function FlowSummaryPanel(props: FlowSummaryPanelProps) {
	return (
		<Panel
			title={props.title}
			borderColor={props.focused ? cockpitTheme.accent : cockpitTheme.border}
			style={{ flexGrow: 1 }}
			contentStyle={{ flexGrow: 1, gap: 1 }}
			footerBadges={[
				{ text: props.stepLabel },
				{ text: props.focused ? 'focused' : 'background', tone: props.focused ? 'accent' : 'neutral' }
			]}
		>
			<text style={{ fg: cockpitTheme.brightText }}>{props.stepLabel}</text>
			<text style={{ fg: cockpitTheme.secondaryText }}>{props.helperText}</text>

			<Show when={props.items.length > 0} fallback={<text style={{ fg: cockpitTheme.secondaryText }}>Complete the current step to continue.</text>}>
				<box style={{ flexDirection: 'column', marginTop: 1, gap: 1 }}>
					<For each={props.items}>
						{(item) => (
							<box style={{ flexDirection: 'column' }}>
								<text style={{ fg: cockpitTheme.labelText }}>{item.label}</text>
								<text style={{ fg: cockpitTheme.bodyText }}>{item.value}</text>
							</box>
						)}
					</For>
				</box>
			</Show>
		</Panel>
	);
}