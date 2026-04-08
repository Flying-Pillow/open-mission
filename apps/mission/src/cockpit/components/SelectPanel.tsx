/** @jsxImportSource @opentui/solid */

import type { SelectOption } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/solid';
import { createMemo, Show } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { Panel } from './Panel.js';
import type { CockpitKeyEvent, SelectItem } from './types.js';

type SelectPanelProps = {
	title: string;
	items: SelectItem[];
	selectedItemId: string | undefined;
	focused: boolean;
	emptyLabel: string;
	helperText?: string;
	filterValue?: string;
	style?: Record<string, string | number | undefined>;
	maxVisibleOptions?: number;
	showSelectionSummary?: boolean;
	showFooterBadges?: boolean;
	onItemChange: (itemId: string) => void;
	onItemSelect: (itemId: string) => void;
	onKeyDown?: (event: CockpitKeyEvent) => void;
};

export function SelectPanel(props: SelectPanelProps) {
	const terminal = useTerminalDimensions();
	const availableOptionWidth = createMemo(() =>
		computeOptionWidth(terminal().width, props.style?.['width'])
	);
	const options = createMemo<SelectOption[]>(() =>
		props.items.map((item) => {
			const [leftWidth, rightWidth] = splitOptionColumns(availableOptionWidth());
			return {
				name: formatOptionLine(item.label, item.description, leftWidth, rightWidth),
				description: '',
				value: item.id
			};
		})
	);
	const selectedItem = createMemo(() => {
		if (props.selectedItemId) {
			const exactMatch = props.items.find((item) => item.id === props.selectedItemId);
			if (exactMatch) {
				return exactMatch;
			}
		}
		return props.items[0];
	});

	return (
		<Panel
			title={props.title}
			borderColor={props.focused ? cockpitTheme.accent : cockpitTheme.border}
			style={{ flexGrow: 1, ...(props.style ?? {}) }}
			contentStyle={{ flexGrow: 1, gap: 1 }}
			{...(props.showFooterBadges === false
				? {}
				: {
					footerBadges: [
						{ text: `${String(props.items.length)} options` },
						{ text: props.focused ? 'focused' : 'background', tone: props.focused ? 'accent' : 'neutral' }
					]
				})}
		>
			<Show when={props.items.length > 0} fallback={<text style={{ fg: cockpitTheme.secondaryText }}>{props.emptyLabel}</text>}>
				<Show when={props.filterValue?.trim().length}>
					<text style={{ fg: cockpitTheme.brightText }}>{`Filter: ${props.filterValue}`}</text>
				</Show>
				<Show when={props.helperText}>
					<text style={{ fg: cockpitTheme.secondaryText }}>{props.helperText}</text>
				</Show>
				<Show when={props.showSelectionSummary !== false}>
					<text style={{ fg: cockpitTheme.brightText }}>{selectedItem()?.label ?? 'No option selected'}</text>
					<text style={{ fg: cockpitTheme.secondaryText }}>{selectedItem()?.description ?? props.emptyLabel}</text>
				</Show>

				<box
					style={{
						...(props.showSelectionSummary === false ? {} : { marginTop: 1 }),
						flexGrow: 1
					}}
				>
					<select
						focused={props.focused}
						height="100%"
						width="100%"
						options={options()}
						backgroundColor={cockpitTheme.panelBackground}
						textColor={cockpitTheme.bodyText}
						focusedBackgroundColor={cockpitTheme.panelBackground}
						focusedTextColor={cockpitTheme.primaryText}
						selectedBackgroundColor={cockpitTheme.accentSoft}
						selectedTextColor={cockpitTheme.brightText}
						descriptionColor={cockpitTheme.secondaryText}
						selectedDescriptionColor={cockpitTheme.primaryText}
						showDescription={false}
						onKeyDown={(event) => {
							props.onKeyDown?.(event);
						}}
						onChange={(_index, option) => {
							props.onItemChange(String(option?.value ?? ''));
						}}
						onSelect={(_index, option) => {
							props.onItemSelect(String(option?.value ?? ''));
						}}
					/>
				</box>
			</Show>
		</Panel>
	);
}

function computeOptionWidth(terminalWidth: number, styleWidth: string | number | undefined): number {
	const fallbackWidth = Math.max(24, terminalWidth - 10);
	if (typeof styleWidth === 'number' && Number.isFinite(styleWidth)) {
		return Math.max(24, Math.floor(styleWidth) - 6);
	}
	if (typeof styleWidth === 'string' && styleWidth.endsWith('%')) {
		const percent = Number.parseFloat(styleWidth.slice(0, -1));
		if (Number.isFinite(percent)) {
			return Math.max(24, Math.floor((terminalWidth * percent) / 100) - 6);
		}
	}
	return fallbackWidth;
}

function splitOptionColumns(totalWidth: number): [number, number] {
	const gutterWidth = 3;
	const innerWidth = Math.max(10, totalWidth - gutterWidth);
	const leftWidth = Math.max(10, Math.floor(innerWidth * 0.42));
	const rightWidth = Math.max(8, innerWidth - leftWidth);
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