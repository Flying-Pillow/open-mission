/** @jsxImportSource @opentui/solid */

import { SyntaxStyle, type TextareaRenderable } from '@opentui/core';
import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { Panel, type PanelBadge } from './Panel.js';

export type ComposerTab = 'write' | 'preview';

type ExpandedCommandComposerProps = {
	title: string;
	stepLabel: string;
	helperText: string;
	initialValue: string;
	placeholder: string;
	focused: boolean;
	format: 'plain' | 'markdown';
	activeTab: ComposerTab;
	onTabChange: (tab: ComposerTab) => void;
	onValueChange: (value: string) => void;
	onSubmit: (value: string) => void;
};

const composerMarkdownSyntaxStyle = SyntaxStyle.fromTheme([
	{
		scope: ['default'],
		style: { foreground: cockpitTheme.bodyText }
	},
	{
		scope: ['markup.heading'],
		style: { foreground: cockpitTheme.brightText, bold: true }
	},
	{
		scope: ['markup.raw'],
		style: { foreground: cockpitTheme.metaText }
	},
	{
		scope: ['markup.link', 'markup.link.label'],
		style: { foreground: cockpitTheme.accent, underline: true }
	},
	{
		scope: ['markup.link.url'],
		style: { foreground: cockpitTheme.secondaryText, underline: true }
	},
	{
		scope: ['markup.strong'],
		style: { foreground: cockpitTheme.primaryText, bold: true }
	},
	{
		scope: ['markup.italic'],
		style: { foreground: cockpitTheme.primaryText, italic: true }
	},
	{
		scope: ['conceal'],
		style: { foreground: cockpitTheme.border }
	}
]);

export function ExpandedCommandComposer(props: ExpandedCommandComposerProps) {
	let textareaRef: TextareaRenderable | undefined;
	const [draft, setDraft] = createSignal(props.initialValue);
	const previewEnabled = createMemo(() => props.format === 'markdown');
	const footerBadges = createMemo<PanelBadge[]>(() => [
		{ text: props.stepLabel },
		{
			text: props.activeTab === 'preview' ? 'preview' : 'write',
			tone: props.activeTab === 'preview' ? ('accent' as const) : ('neutral' as const)
		},
		...(previewEnabled() ? [{ text: 'Ctrl+P/Tab preview', framed: false as const }] : []),
		{ text: 'Enter submit', framed: false as const },
		{ text: 'Shift+Enter newline', framed: false as const },
		{
			text: props.focused ? 'focused' : 'background',
			tone: props.focused ? ('accent' as const) : ('neutral' as const)
		}
	]);

	createEffect(() => {
		setDraft(props.initialValue);
	});

	return (
		<Panel
			title={props.title}
			borderColor={props.focused ? cockpitTheme.accent : cockpitTheme.border}
			style={{ flexGrow: 1 }}
			contentStyle={{ flexGrow: 1, gap: 1 }}
			footerBadges={footerBadges()}
		>
			<text style={{ fg: cockpitTheme.secondaryText }}>{props.helperText}</text>

			<Show when={previewEnabled()}>
				<box style={{ flexDirection: 'row', gap: 2 }}>
					<text style={{ fg: props.activeTab === 'write' ? cockpitTheme.accent : cockpitTheme.labelText }}>
						{props.activeTab === 'write' ? 'WRITE' : 'write'}
					</text>
					<text style={{ fg: cockpitTheme.border }}>|</text>
					<text style={{ fg: props.activeTab === 'preview' ? cockpitTheme.accent : cockpitTheme.labelText }}>
						{props.activeTab === 'preview' ? 'PREVIEW' : 'preview'}
					</text>
				</box>
			</Show>

			<box style={{ flexGrow: 1 }}>
				<Show
					when={previewEnabled() && props.activeTab === 'preview'}
					fallback={
						<textarea
							ref={(value) => {
								textareaRef = value;
							}}
							onKeyDown={(event) => {
								if ((event.name === 'return' || event.name === 'enter') && !event.shift) {
									event.preventDefault();
									event.stopPropagation();
									props.onSubmit(textareaRef?.plainText ?? draft());
								}
							}}
							focused={props.focused}
							width="100%"
							height="100%"
							placeholder={props.placeholder}
							initialValue={draft()}
							backgroundColor={cockpitTheme.panelBackground}
							textColor={cockpitTheme.bodyText}
							focusedBackgroundColor={cockpitTheme.panelBackground}
							focusedTextColor={cockpitTheme.primaryText}
							placeholderColor={cockpitTheme.mutedText}
							onContentChange={() => {
								const nextValue = textareaRef?.plainText ?? draft();
								setDraft(nextValue);
								props.onValueChange(nextValue);
							}}
							onSubmit={() => {
								props.onSubmit(textareaRef?.plainText ?? draft());
							}}
						/>
					}
				>
					<scrollbox focused={props.focused} style={{ flexGrow: 1 }}>
						<Show when={draft().trim().length > 0} fallback={<text style={{ fg: cockpitTheme.secondaryText }}>Nothing to preview yet.</text>}>
							<markdown
								content={draft()}
								syntaxStyle={composerMarkdownSyntaxStyle}
								fg={cockpitTheme.bodyText}
								width="100%"
							/>
						</Show>
					</scrollbox>
				</Show>
			</box>
		</Panel>
	);
}