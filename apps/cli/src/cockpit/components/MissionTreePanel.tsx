/** @jsxImportSource @opentui/solid */
    
import { useTerminalDimensions } from '@opentui/solid';
import { createMemo } from 'solid-js';
import type { MissionStageProgress, MissionTaskStatus } from '@flying-pillow/mission-core';
import { Panel, type PanelBodyLine } from './Panel.js';
import { cockpitTheme } from './cockpitTheme.js';
import { progressStateTone } from './progressStateTone.js';

export type MissionTreeSessionNode = {
	id: string;
	label: string;
	selected: boolean;
	lifecycleState: string;
};

export type MissionTreeTaskNode = {
	id: string;
	label: string;
	selected: boolean;
	status: MissionTaskStatus;
	collapsed: boolean;
	artifact?: {
		id: string;
		label: string;
		selected: boolean;
	};
	sessions: MissionTreeSessionNode[];
};

export type MissionTreeStageNode = {
	id: string;
	label: string;
	selected: boolean;
	status: MissionStageProgress;
	collapsed: boolean;
	artifact?: {
		id: string;
		label: string;
		selected: boolean;
	};
	tasks: MissionTreeTaskNode[];
};

type MissionTreePanelProps = {
	focused: boolean;
	stages: MissionTreeStageNode[];
	emptyLabel: string;
};

type TreeLine = PanelBodyLine & {
	text: string;
	color: string;
	selected: boolean;
	backgroundColor: string;
};

export function MissionTreePanel(props: MissionTreePanelProps) {
	const terminal = useTerminalDimensions();
	const lines = createMemo<TreeLine[]>(() => buildTreeLines(props.stages));
	const treeContentWidth = createMemo(() => {
		const centerWidth = Math.max(terminal().width - 2, 20);
		const treePaneWidth = Math.max(Math.floor((centerWidth - 1) * 0.25), 20);
		return Math.max(treePaneWidth + 5, 8);
	});
	const bodyLines = createMemo<PanelBodyLine[]>(() =>
		lines().map((line) => ({
			text: line.text,
			fg: line.selected ? cockpitTheme.primaryText : line.color,
			backgroundColor: line.selected ? line.backgroundColor : cockpitTheme.panelBackground
		}))
	);
	return (
		<Panel
			title="FLIGHT-DECK"
			titleColor={cockpitTheme.title}
			borderColor={props.focused ? cockpitTheme.accent : cockpitTheme.border}
			bodyLines={bodyLines()}
			bodyRows={bodyLines().length > 0 ? bodyLines().length : 1}
			contentWidth={treeContentWidth()}
			style={{ flexGrow: 1, width: '100%', minWidth: '100%', maxWidth: '100%' }}
			{...(bodyLines().length === 0
				? {
					bodyLines: [{ text: props.emptyLabel, fg: cockpitTheme.secondaryText }],
					bodyRows: 1
				}
				: {})}
		/>
	);
}

function buildTreeLines(stages: MissionTreeStageNode[]): TreeLine[] {
	const lines: TreeLine[] = [];
	for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
		const stage = stages[stageIndex];
		if (!stage) {
			continue;
		}
		const stageHasChildren = Boolean(stage.artifact) || stage.tasks.length > 0;
		const stageDisclosure = stageHasChildren ? `${stage.collapsed ? '▸' : '▾'} ` : '';
		lines.push({
			text: `${stageDisclosure}${stage.label}`,
			color: stageTone(stage.status),
			selected: stage.selected,
			backgroundColor: selectedRowBackground(stageTone(stage.status))
		});

		if (stage.collapsed) {
			continue;
		}
		const stageChildren = buildStageChildren(stage);
		for (let childIndex = 0; childIndex < stageChildren.length; childIndex += 1) {
			const child = stageChildren[childIndex];
			if (!child) {
				continue;
			}
			const stageIndent = '  ';
			lines.push({
				text: `${stageIndent}${child.label}`,
				color: child.color,
				selected: child.selected,
				backgroundColor: selectedRowBackground(child.color)
			});

			for (let grandIndex = 0; grandIndex < child.children.length; grandIndex += 1) {
				const grandChild = child.children[grandIndex];
				if (!grandChild) {
					continue;
				}
				const childIndent = '  ';
				lines.push({
					text: `${stageIndent}${childIndent}${grandChild.label}`,
					color: grandChild.color,
					selected: grandChild.selected,
					backgroundColor: selectedRowBackground(grandChild.color)
				});
			}
		}
	}
	return lines;
}

function buildStageChildren(stage: MissionTreeStageNode): Array<{ label: string; color: string; selected: boolean; children: Array<{ label: string; color: string; selected: boolean }> }> {
	const children: Array<{ label: string; color: string; selected: boolean; children: Array<{ label: string; color: string; selected: boolean }> }> = [];
	const stageColor = stageTone(stage.status);
	if (stage.artifact) {
		children.push({
			label: stage.artifact.label,
			color: stageColor,
			selected: stage.artifact.selected,
			children: []
		});
	}

	for (const task of stage.tasks) {
		const taskColor = taskTone(task.status);
		const grandchildren: Array<{ label: string; color: string; selected: boolean }> = [];
		if (task.artifact) {
			grandchildren.push({
				label: task.artifact.label,
				color: taskColor,
				selected: task.artifact.selected
			});
		}
		if (!task.collapsed) {
			for (const session of task.sessions) {
				const sessionColor = sessionTone(session.lifecycleState, taskColor);
				grandchildren.push({
					label: session.label,
					color: sessionColor,
					selected: session.selected
				});
			}
		}
		const taskHasChildren = Boolean(task.artifact) || task.sessions.length > 0;
		const taskDisclosure = taskHasChildren ? `${task.collapsed ? '▸' : '▾'} ` : '';
		children.push({
			label: `${taskDisclosure}${task.label}`,
			color: taskColor,
			selected: task.selected,
			children: grandchildren
		});
	}

	return children;
}

function stageTone(status: MissionStageProgress): string {
	return progressStateTone(status);
}

function taskTone(status: MissionTaskStatus): string {
	return progressStateTone(status);
}

function sessionTone(state: string, fallbackColor: string): string {
	if (state === 'running') {
		return cockpitTheme.success;
	}
	if (state === 'failed') {
		return cockpitTheme.danger;
	}
	if (state === 'cancelled') {
		return cockpitTheme.warning;
	}
	if (state === 'completed') {
		return cockpitTheme.primaryText;
	}
	return fallbackColor;
}

function selectedRowBackground(statusColor: string): string {
	const mixed = mixHexColors(cockpitTheme.panelBackground, statusColor, 0.28);
	return mixed ?? cockpitTheme.accentSoft;
}

function mixHexColors(base: string, tone: string, toneWeight: number): string | undefined {
	const baseRgb = hexToRgb(base);
	const toneRgb = hexToRgb(tone);
	if (!baseRgb || !toneRgb) {
		return undefined;
	}
	const weight = Math.max(0, Math.min(1, toneWeight));
	const r = Math.round(baseRgb.r * (1 - weight) + toneRgb.r * weight);
	const g = Math.round(baseRgb.g * (1 - weight) + toneRgb.g * weight);
	const b = Math.round(baseRgb.b * (1 - weight) + toneRgb.b * weight);
	return rgbToHex(r, g, b);
}

function hexToRgb(value: string): { r: number; g: number; b: number } | undefined {
	const match = /^#([0-9a-fA-F]{6})$/u.exec(value.trim());
	const hex = match?.[1];
	if (!hex) {
		return undefined;
	}
	return {
		r: Number.parseInt(hex.slice(0, 2), 16),
		g: Number.parseInt(hex.slice(2, 4), 16),
		b: Number.parseInt(hex.slice(4, 6), 16)
	};
}

function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (channel: number) => channel.toString(16).padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
