/** @jsxImportSource @opentui/solid */

import type { InputRenderable, SelectOption } from '@opentui/core';
import { For, Show, createMemo } from 'solid-js';
import { towerTheme } from '../towerTheme.js';
import { Panel, type PanelBadge } from '../Panel.js';
import type { TowerKeyEvent, SelectItem } from '../types.js';

export type RepositoryFlowSummaryItem = {
	label: string;
	value: string;
};

type RepositoryFlowPanelBody =
	| {
		kind: 'idle';
		emptyLabel: string;
		previewTitle?: string;
		previewText?: string;
	  }
	| {
		kind: 'selection';
		items: SelectItem[];
		selectedItemId: string | undefined;
		emptyLabel: string;
		selectionMode: 'single' | 'multiple';
		onItemChange: (itemId: string) => void;
		onItemSelect: (itemId: string) => void;
		onKeyDown?: (event: TowerKeyEvent) => void;
	  }
	| {
		kind: 'text';
		value: string;
		placeholder: string;
		onInputChange: (value: string) => void;
		onInputSubmit: (value?: string) => void;
		onInputKeyDown?: (event: TowerKeyEvent) => void;
	  };

type RepositoryFlowPanelProps = {
	title: string;
	helperText: string;
	summaryItems: RepositoryFlowSummaryItem[];
	focused: boolean;
	stepLabel: string;
	stepIndex: number;
	stepCount: number;
	statusTone: 'neutral' | 'accent' | 'warning';
	statusText: string;
	body: RepositoryFlowPanelBody;
};

export function RepositoryFlowPanel(props: RepositoryFlowPanelProps) {
	let inputRef: InputRenderable | undefined;
	const idleBody = createMemo(() => (props.body.kind === 'idle' ? props.body : undefined));
	const selectionBody = createMemo(() => (props.body.kind === 'selection' ? props.body : undefined));
	const textBody = createMemo(() => (props.body.kind === 'text' ? props.body : undefined));
	const selectedIndex = createMemo(() => {
		const body = selectionBody();
		if (!body) {
			return 0;
		}
		return resolveSelectedIndex(body.items, body.selectedItemId);
	});
	const footerBadges = createMemo<PanelBadge[]>(() => [
		{ text: `${String(props.stepIndex + 1)}/${String(Math.max(props.stepCount, 1))}` },
		{ text: props.stepLabel },
		{ text: props.statusText, tone: props.statusTone },
		{ text: props.focused ? 'focused' : 'background', tone: props.focused ? 'accent' : 'neutral' }
	]);
	const selectOptions = createMemo<SelectOption[]>(() => {
		const body = selectionBody();
		if (!body) {
			return [];
		}
		return body.items.map((item) => ({
			name: item.label,
			description: item.description,
			value: item.id
		}));
	});

	return (
		<Panel
			title={props.title}
			borderColor={props.focused ? towerTheme.accent : towerTheme.border}
			style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}
			contentStyle={{ flexGrow: 1, flexShrink: 1, minHeight: 0, gap: 1 }}
			footerBadges={footerBadges()}
		>
			<text style={{ fg: towerTheme.secondaryText }}>{props.helperText}</text>
			<Show
				when={props.summaryItems.length > 0}
				fallback={<text style={{ fg: towerTheme.mutedText }}>No committed steps yet.</text>}
			>
				<box style={{ flexDirection: 'column', gap: 1 }}>
					<For each={props.summaryItems}>
						{(item) => (
							<box style={{ flexDirection: 'column' }}>
								<text style={{ fg: towerTheme.labelText }}>{item.label}</text>
								<text style={{ fg: towerTheme.bodyText }}>{item.value}</text>
							</box>
						)}
					</For>
				</box>
			</Show>
			<box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, flexDirection: 'column' }}>
				<Show when={idleBody()} keyed>
					{(body) => (
					<box style={{ flexDirection: 'column', justifyContent: 'center', flexGrow: 1, gap: 1 }}>
						<text style={{ fg: towerTheme.bodyText }}>{body.emptyLabel}</text>
						<Show when={body.previewTitle}><text style={{ fg: towerTheme.labelText }}>{body.previewTitle}</text></Show>
						<Show when={body.previewText}><text style={{ fg: towerTheme.secondaryText }}>{body.previewText}</text></Show>
					</box>
					)}
				</Show>
				<Show when={selectionBody()} keyed>
					{(body) => (
					<Show
						when={body.items.length > 0}
						fallback={<text style={{ fg: towerTheme.secondaryText }}>{body.emptyLabel}</text>}
					>
						<select
							focused={props.focused}
							height="100%"
							width="100%"
							options={selectOptions()}
							selectedIndex={selectedIndex()}
							backgroundColor={towerTheme.panelBackground}
							textColor={towerTheme.bodyText}
							focusedBackgroundColor={towerTheme.panelBackground}
							focusedTextColor={towerTheme.primaryText}
							selectedBackgroundColor={towerTheme.accentSoft}
							selectedTextColor={towerTheme.brightText}
							descriptionColor={towerTheme.secondaryText}
							selectedDescriptionColor={towerTheme.primaryText}
							showDescription={true}
							onKeyDown={(event) => {
								body.onKeyDown?.(event);
							}}
							onChange={(_index, option) => {
								body.onItemChange(String(option?.value ?? ''));
							}}
							onSelect={(_index, option) => {
								body.onItemSelect(String(option?.value ?? ''));
							}}
						/>
					</Show>
					)}
				</Show>
				<Show when={textBody()} keyed>
					{(body) => (
					<box style={{ flexDirection: 'column', justifyContent: 'center', flexGrow: 1 }}>
						<input
							ref={(value) => {
								inputRef = value;
							}}
							focused={props.focused}
							width="100%"
							placeholder={body.placeholder}
							value={body.value}
							onChange={(value) => {
								body.onInputChange(inputRef?.value ?? value);
							}}
							onKeyDown={(event) => {
								body.onInputKeyDown?.(event);
							}}
							onSubmit={(value) => {
								body.onInputSubmit(inputRef?.value ?? (typeof value === 'string' ? value : body.value));
							}}
						/>
					</box>
					)}
				</Show>
			</box>
		</Panel>
	);
}

function resolveSelectedIndex(items: SelectItem[], selectedItemId: string | undefined): number {
	if (items.length === 0) {
		return 0;
	}
	if (!selectedItemId) {
		return 0;
	}
	const index = items.findIndex((item) => item.id === selectedItemId);
	return index >= 0 ? index : 0;
}