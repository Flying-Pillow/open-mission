import { createEffect, createMemo, createSignal } from 'solid-js';
import type { SelectItem } from '../types.js';
import {
	buildFlowSummaryItems,
	resolveFlowStep,
	type ActiveFlowDraft,
	type FlowDefinition,
	type FlowState,
	type FlowStep,
	type FlowStepValue,
	type FlowResult,
} from './flowDomain.js';

type CreateFlowControllerOptions = {
	onNotify: (message: string) => void;
	onFlowClosed?: () => void;
	onFlowRestarted?: (definition: FlowDefinition) => void;
};

export type FlowController = ReturnType<typeof createFlowController>;

export function createFlowController(options: CreateFlowControllerOptions) {
	const [flow, setFlow] = createSignal<FlowState | undefined>();
	const [activeDraft, setActiveDraft] = createSignal<ActiveFlowDraft | undefined>();
	const [isStepCommitInFlight, setIsStepCommitInFlight] = createSignal<boolean>(false);
	const [isRunning, setIsRunning] = createSignal<boolean>(false);

	const currentStep = createMemo<FlowStep | undefined>(() => {
		const activeFlow = flow();
		return activeFlow ? resolveFlowStep(activeFlow.definition, activeFlow.stepIndex) : undefined;
	});
	const owner = createMemo<'repository' | 'mission' | undefined>(() => {
		const activeFlow = flow();
		if (!activeFlow) {
			return undefined;
		}
		return activeFlow.definition.id.startsWith('control.') ? 'repository' : 'mission';
	});
	const currentDraft = createMemo<ActiveFlowDraft | undefined>(() => {
		const explicitDraft = activeDraft();
		if (explicitDraft) {
			return explicitDraft;
		}
		const activeFlow = flow();
		const step = currentStep();
		if (!activeFlow || !step) {
			return undefined;
		}
		return buildInitialFlowDraft(activeFlow, step);
	});
	const selectionItems = createMemo<SelectItem[]>(() => {
		const step = currentStep();
		const activeFlow = flow();
		const draft = currentDraft();
		if (!step || step.kind !== 'selection' || draft?.kind !== 'selection') {
			return [];
		}
		const selectedIds = new Set(draft.selectedItemIds);
		return step.items(activeFlow?.steps ?? []).map((item) => ({
			...item,
			...(step.selectionMode === 'multiple'
				? { label: `${selectedIds.has(item.id) ? '[x]' : '[ ]'} ${item.label}` }
				: {})
		}));
	});
	const selectedSelectionItemId = createMemo<string | undefined>(() => {
		const draft = currentDraft();
		return draft?.kind === 'selection'
			? pickSelectItemId(selectionItems(), draft.highlightedItemId)
			: undefined;
	});
	const summaryItems = createMemo(() => {
		const activeFlow = flow();
		if (!activeFlow) {
			return [];
		}
		return buildFlowSummaryItems(activeFlow.steps.slice(0, activeFlow.stepIndex));
	});
	const isMissionSelectionOverlay = createMemo(() => {
		const step = currentStep();
		return owner() === 'mission' && step?.kind === 'selection';
	});
	const isMissionTextStep = createMemo(() => {
		const step = currentStep();
		return owner() === 'mission' && step?.kind === 'text';
	});
	const textValue = createMemo(() => {
		const draft = currentDraft();
		return draft?.kind === 'text' ? draft.value : '';
	});

	createEffect(() => {
		const activeFlow = flow();
		const step = currentStep();
		if (!activeFlow || !step) {
			setActiveDraft(undefined);
			return;
		}
		const nextDraft = buildInitialFlowDraft(activeFlow, step);
		if (step.kind === 'selection' && nextDraft?.kind === 'selection') {
			const items = step.items(activeFlow.steps);
			if (items.length === 0) {
				options.onNotify(step.emptyLabel);
				reset();
				return;
			}
		}
		setActiveDraft(nextDraft);
	});

	function start(definition: FlowDefinition): void {
		if (definition.steps.length === 0) {
			return;
		}
		setFlow({
			definition,
			stepIndex: 0,
			steps: []
		});
		setActiveDraft(undefined);
	}

	function reset(): void {
		setFlow(undefined);
		setActiveDraft(undefined);
		setIsStepCommitInFlight(false);
		setIsRunning(false);
	}

	function retreat(): void {
		const activeFlow = flow();
		if (!activeFlow || activeFlow.stepIndex === 0) {
			return;
		}
		setFlow({
			definition: activeFlow.definition,
			stepIndex: activeFlow.stepIndex - 1,
			steps: activeFlow.steps
		});
	}

	function setSelectionHighlight(itemId: string): void {
		const draft = currentDraft();
		if (draft?.kind !== 'selection') {
			return;
		}
		setActiveDraft({
			kind: 'selection',
			highlightedItemId: itemId,
			selectedItemIds: [...draft.selectedItemIds]
		});
	}

	function setTextValue(value: string): void {
		const step = currentStep();
		if (step?.kind !== 'text') {
			return;
		}
		setActiveDraft({ kind: 'text', value });
	}

	function moveSelection(delta: number): void {
		const draft = currentDraft();
		if (draft?.kind !== 'selection') {
			return;
		}
		const nextId = movePickerSelection(selectionItems(), draft.highlightedItemId, delta);
		if (!nextId) {
			return;
		}
		setSelectionHighlight(nextId);
	}

	function toggleCurrentSelection(): void {
		const step = currentStep();
		const draft = currentDraft();
		if (!step || step.kind !== 'selection' || step.selectionMode !== 'multiple' || draft?.kind !== 'selection') {
			return;
		}
		const itemId = draft.highlightedItemId;
		if (!itemId) {
			return;
		}
		setActiveDraft({
			kind: 'selection',
			highlightedItemId: itemId,
			selectedItemIds: draft.selectedItemIds.includes(itemId)
				? draft.selectedItemIds.filter((candidate) => candidate !== itemId)
				: [...draft.selectedItemIds, itemId]
		});
	}

	function isCurrentStepMultiSelect(): boolean {
		const step = currentStep();
		return step?.kind === 'selection' && step.selectionMode === 'multiple';
	}

	async function commitCurrentStep(): Promise<void> {
		if (isStepCommitInFlight()) {
			return;
		}
		const activeFlow = flow();
		const step = currentStep();
		const draft = currentDraft();
		if (!activeFlow || !step || !draft) {
			return;
		}
		setIsStepCommitInFlight(true);
		try {
			if (step.kind === 'selection' && draft.kind === 'selection') {
				const highlightedId = draft.highlightedItemId;
				const optionIds = step.selectionMode === 'multiple'
					? draft.selectedItemIds
					: highlightedId ? [highlightedId] : [];
				if (optionIds.length === 0) {
					options.onNotify(`Select at least one ${step.label.toLowerCase()}.`);
					return;
				}
				const optionLabels = step.items(activeFlow.steps.slice(0, activeFlow.stepIndex))
					.filter((candidate) => optionIds.includes(candidate.id))
					.map((candidate) => candidate.label);
				await advance({
					kind: 'selection',
					stepId: step.id,
					label: step.label,
					optionIds,
					optionLabels
				});
				return;
			}
			if (step.kind === 'text' && draft.kind === 'text') {
				if (draft.value.trim().length === 0) {
					options.onNotify(`Enter ${step.label.toLowerCase()} before continuing.`);
					return;
				}
				await advance({
					kind: 'text',
					stepId: step.id,
					label: step.label,
					value: draft.value
				});
			}
		} finally {
			setIsStepCommitInFlight(false);
		}
	}

	async function advance(nextStepValue: FlowStepValue): Promise<void> {
		const activeFlow = flow();
		if (!activeFlow) {
			return;
		}
		const nextSteps = [...activeFlow.steps.slice(0, activeFlow.stepIndex), nextStepValue];
		const nextDefinition = activeFlow.definition.resolveDefinition
			? await activeFlow.definition.resolveDefinition(nextSteps)
			: activeFlow.definition;
		const nextStep = nextDefinition.steps[activeFlow.stepIndex + 1];
		if (nextStep) {
			setFlow({
				definition: nextDefinition,
				stepIndex: activeFlow.stepIndex + 1,
				steps: nextSteps
			});
			return;
		}
		await complete({
			flowId: activeFlow.definition.id,
			steps: nextSteps
		});
	}

	async function complete(result: FlowResult): Promise<void> {
		const activeFlow = flow();
		if (!activeFlow) {
			return;
		}
		setIsRunning(true);
		try {
			const completion = await activeFlow.definition.onComplete(result);
			if (completion?.kind === 'restart') {
				start(completion.definition);
				options.onFlowRestarted?.(completion.definition);
				return;
			}
			reset();
			options.onFlowClosed?.();
		} catch (error) {
			options.onNotify(toErrorMessage(error));
			// If execution fails at completion time, close the flow so the shell can
			// return to its normal repository/mission surface instead of staying stuck
			// on the last flow step.
			reset();
			options.onFlowClosed?.();
		} finally {
			setIsRunning(false);
		}
	}

	return {
		flow,
		currentStep,
		currentDraft,
		owner,
		selectionItems,
		selectedSelectionItemId,
		summaryItems,
		textValue,
		isRunning,
		isMissionSelectionOverlay,
		isMissionTextStep,
		start,
		reset,
		retreat,
		setSelectionHighlight,
		setTextValue,
		moveSelection,
		toggleCurrentSelection,
		isCurrentStepMultiSelect,
		commitCurrentStep,
	};
}

function buildInitialFlowDraft(
	flow: FlowState,
	step: FlowStep
): ActiveFlowDraft | undefined {
	const committedValue = flow.steps[flow.stepIndex];
	if (step.kind === 'selection') {
		const committedSelection = committedValue?.kind === 'selection' ? committedValue : undefined;
		const selectedItemIds = committedSelection?.optionIds ?? [];
		const highlightedItemId = pickSelectItemId(
			step.items(flow.steps.slice(0, flow.stepIndex)),
			committedSelection?.optionIds[0]
		);
		return {
			kind: 'selection',
			highlightedItemId,
			selectedItemIds: [...selectedItemIds]
		};
	}
	const committedText = committedValue?.kind === 'text' ? committedValue.value : undefined;
	return {
		kind: 'text',
		value: committedText ?? step.initialValue
	};
}

function pickSelectItemId(items: SelectItem[], current: string | undefined): string | undefined {
	if (items.length === 0) {
		return undefined;
	}
	if (current && items.some((item) => item.id === current)) {
		return current;
	}
	return items[0]?.id;
}

function movePickerSelection(items: SelectItem[], current: string | undefined, delta: number): string | undefined {
	if (items.length === 0) {
		return undefined;
	}
	const currentId = pickSelectItemId(items, current);
	const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId));
	const nextIndex = (currentIndex + delta + items.length) % items.length;
	return items[nextIndex]?.id;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}