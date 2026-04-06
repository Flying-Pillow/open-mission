/** @jsxImportSource @opentui/solid */

import type { InputRenderable, SelectOption } from '@opentui/core';
import { For, Show, createMemo } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { Panel, type PanelBadge } from './Panel.js';
import type { SelectItem } from './types.js';

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
	  }
	| {
		kind: 'text';
		value: string;
		placeholder: string;
		onInputChange: (value: string) => void;
		onInputSubmit: (value?: string) => void;
		onInputKeyDown?: (event: {
			name?: string;
			preventDefault: () => void;
			stopPropagation: () => void;
		}) => void;
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
			borderColor={props.focused ? cockpitTheme.accent : cockpitTheme.border}
			style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}
			contentStyle={{ flexGrow: 1, flexShrink: 1, minHeight: 0, gap: 1 }}
			footerBadges={footerBadges()}
		>
			<text style={{ fg: cockpitTheme.secondaryText }}>{props.helperText}</text>
			<Show
				when={props.summaryItems.length > 0}
				fallback={<text style={{ fg: cockpitTheme.mutedText }}>No committed steps yet.</text>}
			>
				<box style={{ flexDirection: 'column', gap: 1 }}>
					<For each={props.summaryItems}>
						{(item) => (
							<box style={{ flexDirection: 'column' }}>
								<text style={{ fg: cockpitTheme.labelText }}>{item.label}</text>
								<text style={{ fg: cockpitTheme.bodyText }}>{item.value}</text>
							</box>
						)}
					</For>
				</box>
			</Show>
			<box style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, flexDirection: 'column' }}>
				<Show when={idleBody()} keyed>
					{(body) => (
					<box style={{ flexDirection: 'column', justifyContent: 'center', flexGrow: 1, gap: 1 }}>
						<text style={{ fg: cockpitTheme.bodyText }}>{body.emptyLabel}</text>
						<Show when={body.previewTitle}><text style={{ fg: cockpitTheme.labelText }}>{body.previewTitle}</text></Show>
						<Show when={body.previewText}><text style={{ fg: cockpitTheme.secondaryText }}>{body.previewText}</text></Show>
					</box>
					)}
				</Show>
				<Show when={selectionBody()} keyed>
					{(body) => (
					<Show
						when={body.items.length > 0}
						fallback={<text style={{ fg: cockpitTheme.secondaryText }}>{body.emptyLabel}</text>}
					>
						<select
							focused={props.focused}
							height="100%"
							width="100%"
							options={selectOptions()}
							backgroundColor={cockpitTheme.panelBackground}
							textColor={cockpitTheme.bodyText}
							focusedBackgroundColor={cockpitTheme.panelBackground}
							focusedTextColor={cockpitTheme.primaryText}
							selectedBackgroundColor={cockpitTheme.accentSoft}
							selectedTextColor={cockpitTheme.brightText}
							descriptionColor={cockpitTheme.secondaryText}
							selectedDescriptionColor={cockpitTheme.primaryText}
							showDescription={true}
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