/** @jsxImportSource @opentui/solid */

import { createMemo, type JSXElement } from 'solid-js';
import { FlowSummaryPanel } from './FlowSummaryPanel.js';
import { RepositoryFlowPanel } from './RepositoryFlowPanel.js';
import { FlowInputPanel } from './FlowInputPanel.js';
import { FlowTextareaPanel } from './FlowTextareaPanel.js';
import { SelectPanel } from '../SelectPanel.js';
import type { FlowController } from './createFlowController.js';

type RepositoryFlowPreview = {
	title: string;
	text: string;
};

type RepositoryFlowSurfaceProps = {
	controller: FlowController;
	focused: boolean;
	preview?: RepositoryFlowPreview;
	onCancel?: () => void;
};

type MissionFlowOverlayProps = {
	controller: FlowController;
	flowFocused: boolean;
	commandFocused: boolean;
	onCancel?: () => void;
};

export function RepositoryFlowSurface(props: RepositoryFlowSurfaceProps): JSXElement {
	const content = createMemo<JSXElement>(() => {
		const step = props.controller.currentStep();
		const draft = props.controller.currentDraft();
		const flow = props.controller.flow();
		const panelTitle = resolveFlowPanelTitle(props.controller, 'REPOSITORY FLOW');
		if (!step) {
			return (
				<RepositoryFlowPanel
					title="REPOSITORY FLOW"
					helperText="Use slash commands from the bottom panel to start a repository flow."
					summaryItems={[]}
					focused={props.focused}
					stepLabel="IDLE"
					stepIndex={0}
					stepCount={1}
					statusTone="neutral"
					statusText="idle"
					body={{
						kind: 'idle',
						emptyLabel: 'Repository mode is ready. Start a slash-command flow from the command panel.',
						...(props.preview
							? {
								previewTitle: props.preview.title,
								previewText: props.preview.text
							}
							: {})
					}}
				/>
			);
		}
		if (step.kind === 'selection' && draft?.kind === 'selection') {
			return (
				<RepositoryFlowPanel
					title={panelTitle}
					helperText={step.helperText}
					summaryItems={props.controller.summaryItems()}
					focused={props.focused}
					stepLabel={step.label}
					stepIndex={flow?.stepIndex ?? 0}
					stepCount={flow?.definition.steps.length ?? 1}
					statusTone={draft.selectedItemIds.length > 0 ? 'accent' : 'warning'}
					statusText={draft.selectedItemIds.length > 0 ? 'ready' : 'blocked'}
					body={{
						kind: 'selection',
						items: props.controller.selectionItems(),
						selectedItemId: props.controller.selectedSelectionItemId(),
						emptyLabel: step.emptyLabel,
						selectionMode: step.selectionMode,
						onKeyDown: (event) => {
							if (event.name === 'escape') {
								event.preventDefault();
								event.stopPropagation();
								props.onCancel?.();
								return;
							}
							if (event.name === 'right') {
								event.preventDefault();
								event.stopPropagation();
								void props.controller.commitCurrentStep();
								return;
							}
							if (event.name === 'left') {
								event.preventDefault();
								event.stopPropagation();
								props.controller.retreat();
								return;
							}
							if (event.sequence === ' ' && props.controller.isCurrentStepMultiSelect()) {
								event.preventDefault();
								event.stopPropagation();
								props.controller.toggleCurrentSelection();
								return;
							}
							if (event.name === 'enter' || event.name === 'return') {
								event.preventDefault();
								event.stopPropagation();
								void props.controller.commitCurrentStep();
							}
						},
						onItemChange: (itemId) => {
							props.controller.setSelectionHighlight(itemId);
						},
						onItemSelect: (itemId) => {
							props.controller.setSelectionHighlight(itemId);
						}
					}}
				/>
			);
		}
		if (step.kind === 'text' && draft?.kind === 'text') {
			return (
				<RepositoryFlowPanel
					title={panelTitle}
					helperText={step.helperText}
					summaryItems={props.controller.summaryItems()}
					focused={props.focused}
					stepLabel={step.label}
					stepIndex={flow?.stepIndex ?? 0}
					stepCount={flow?.definition.steps.length ?? 1}
					statusTone={draft.value.trim().length > 0 ? 'accent' : 'warning'}
					statusText={draft.value.trim().length > 0 ? 'ready' : 'blocked'}
					body={{
						kind: 'text',
						value: draft.value,
						placeholder: step.placeholder,
						onInputKeyDown: (event) => {
							if (event.name === 'escape') {
								event.preventDefault();
								event.stopPropagation();
								props.onCancel?.();
								return;
							}
							if (event.ctrl && event.name === 'right') {
								event.preventDefault();
								event.stopPropagation();
								void props.controller.commitCurrentStep();
								return;
							}
							if (event.ctrl && event.name === 'left') {
								event.preventDefault();
								event.stopPropagation();
								props.controller.retreat();
							}
						},
						onInputChange: (value) => {
							props.controller.setTextValue(value);
						},
						onInputSubmit: () => {
							void props.controller.commitCurrentStep();
						}
					}}
				/>
			);
		}
		return (
			<RepositoryFlowPanel
				title={panelTitle}
				helperText="Preparing flow step..."
				summaryItems={props.controller.summaryItems()}
				focused={props.focused}
				stepLabel="FLOW"
				stepIndex={flow?.stepIndex ?? 0}
				stepCount={flow?.definition.steps.length ?? 1}
				statusTone="warning"
				statusText="blocked"
				body={{ kind: 'idle', emptyLabel: 'The current flow step is not ready yet.' }}
			/>
		);
	});

	return <>{content()}</>;
}

export function MissionFlowOverlay(props: MissionFlowOverlayProps): JSXElement | undefined {
	const content = createMemo<JSXElement | undefined>(() => {
		const step = props.controller.currentStep();
		const draft = props.controller.currentDraft();
		const panelTitle = resolveFlowPanelTitle(props.controller, step?.title ?? 'FLOW');
		if (step?.kind === 'selection') {
			return (
				<SelectPanel
					title={panelTitle}
					items={props.controller.selectionItems()}
					selectedItemId={props.controller.selectedSelectionItemId()}
					focused={props.flowFocused}
					emptyLabel={step.emptyLabel}
					helperText={step.helperText}
					onKeyDown={(event) => {
						if (event.name === 'right') {
							event.preventDefault();
							event.stopPropagation();
							void props.controller.commitCurrentStep();
							return;
						}
						if (event.name === 'left') {
							event.preventDefault();
							event.stopPropagation();
							props.controller.retreat();
							return;
						}
						if (event.sequence === ' ' && props.controller.isCurrentStepMultiSelect()) {
							event.preventDefault();
							event.stopPropagation();
							props.controller.toggleCurrentSelection();
							return;
						}
						if (event.name === 'enter' || event.name === 'return') {
							event.preventDefault();
							event.stopPropagation();
							void props.controller.commitCurrentStep();
							return;
						}
						if (event.name === 'escape') {
							event.preventDefault();
							event.stopPropagation();
							props.onCancel?.();
						}
					}}
					onItemChange={(itemId) => {
						props.controller.setSelectionHighlight(itemId);
					}}
					onItemSelect={(itemId) => {
						props.controller.setSelectionHighlight(itemId);
					}}
				/>
			);
		}
		if (step?.kind === 'text' && draft?.kind === 'text') {
			if (step.inputMode === 'expanded') {
				return (
					<FlowTextareaPanel
						title={panelTitle}
						stepLabel={step.label}
						helperText={step.helperText}
						initialValue={draft.value}
						placeholder={step.placeholder}
						focused={props.flowFocused}
						format={step.format}
						onCancel={() => {
							props.onCancel?.();
						}}
						onValueChange={(value) => {
							props.controller.setTextValue(value);
						}}
						onSubmit={(value) => {
							props.controller.setTextValue(value);
							void props.controller.commitCurrentStep();
						}}
					/>
				);
			}
			return (
				<FlowInputPanel
					title={panelTitle}
					helperText={step.helperText}
					placeholder={step.placeholder}
					inputValue={draft.value}
					focused={props.flowFocused}
					isRunning={props.controller.isRunning()}
					onInputKeyDown={(event) => {
						if (event.name === 'escape') {
							event.preventDefault();
							event.stopPropagation();
							props.onCancel?.();
						}
					}}
					onInputChange={(value) => {
						props.controller.setTextValue(value);
					}}
					onInputSubmit={(value) => {
						props.controller.setTextValue(value ?? draft.value);
						void props.controller.commitCurrentStep();
					}}
				/>
			);
		}
		if (step?.kind === 'text') {
			return (
				<FlowSummaryPanel
					title={panelTitle}
					stepLabel={step.label}
					helperText={step.helperText}
					items={props.controller.summaryItems()}
					focused={props.flowFocused || props.commandFocused}
				/>
			);
		}
		return undefined;
	});

	return <>{content()}</>;
}

function resolveFlowPanelTitle(controller: FlowController, fallbackTitle: string): string {
	const flow = controller.flow();
	const step = controller.currentStep();
	if (!flow || !step) {
		return fallbackTitle;
	}
	const segments = [
		flow.definition.targetLabel,
		...flow.steps.slice(0, flow.stepIndex).map((value) => value.label),
		step.title
	];
	const breadcrumbSegments: string[] = [];
	for (const rawSegment of segments) {
		const segment = rawSegment.trim().toUpperCase();
		if (segment.length === 0 || breadcrumbSegments[breadcrumbSegments.length - 1] === segment) {
			continue;
		}
		breadcrumbSegments.push(segment);
	}
	return breadcrumbSegments.join(' > ');
}