/** @jsxImportSource @opentui/solid */

import type {
	MissionAgentSessionRecord,
	MissionControlPlaneStatus,
	MissionSelectionCandidate
} from '@flying-pillow/mission-core';
import { createMemo } from 'solid-js';
import { towerTheme } from './towerTheme.js';
import { TabPanel, type TabPanelLine } from './TabPanel.js';

type ControlStatusPanelProps = {
	mode: 'setup' | 'root';
	control: MissionControlPlaneStatus | undefined;
	controlSession: MissionAgentSessionRecord | undefined;
	sessionOutputLines: string[];
	selectedTabId?: 'runtime' | 'control';
	focused: boolean;
	tabsFocusable: boolean;
	bodyRows: number;
	availableMissions: MissionSelectionCandidate[];
	workspaceContextLabel: string;
};

export function ControlStatusPanel(props: ControlStatusPanelProps) {
	const runnerLabel = createMemo(() => {
		const runtimeId = props.controlSession?.runtimeId?.trim() || props.control?.settings?.agentRuntime?.trim() || 'runtime';
		return runtimeId.toUpperCase();
	});
	const selectedTabId = createMemo<'runtime' | 'control'>(() => {
		if (props.selectedTabId) {
			return props.selectedTabId;
		}
		return props.controlSession ? 'runtime' : 'control';
	});

	const bodyLines = createMemo<TabPanelLine[]>(() => {
		if (selectedTabId() === 'runtime') {
			return buildRuntimeLines(props);
		}
		return buildControlLines(props);
	});

	return (
		<TabPanel
			focused={props.focused}
			tabs={[
				{ id: 'runtime', label: runnerLabel() },
				{ id: 'control', label: 'CONTROL' }
			]}
			selectedTabId={selectedTabId()}
			tabsFocusable={props.tabsFocusable}
			bodyLines={bodyLines()}
			bodyRows={Math.max(6, props.bodyRows)}
		/>
	);
}

function buildRuntimeLines(props: ControlStatusPanelProps): TabPanelLine[] {
	const control = props.control;
	const session = props.controlSession;
	const lines: TabPanelLine[] = [
		{ text: 'Agent runtime connection for repository root.', fg: towerTheme.brightText },
		{ text: `Opened from ${props.workspaceContextLabel}.`, fg: towerTheme.metaText },
		{ text: '', fg: towerTheme.metaText }
	];

	if (!session) {
		lines.push({ text: 'No active runtime session.', fg: towerTheme.warning });
		lines.push({ text: 'Use /launch to start the configured runtime.', fg: towerTheme.metaText });
		if (!control?.settingsComplete) {
			lines.push({ text: 'Setup incomplete. Use /setup first.', fg: towerTheme.warning });
		}
		return lines;
	}

	lines.push({ text: `Runtime: ${session.runtimeId}`, fg: towerTheme.metaText });
	lines.push({ text: `State: ${session.lifecycleState}`, fg: sessionStateColor(session.lifecycleState) });
	lines.push({ text: '', fg: towerTheme.metaText });
	lines.push({ text: 'Live output:', fg: towerTheme.labelText });
	if (props.sessionOutputLines.length === 0) {
		lines.push({ text: 'No output has been recorded for this session yet.', fg: towerTheme.secondaryText });
	} else {
		for (const line of props.sessionOutputLines) {
			lines.push({ text: line, fg: towerTheme.bodyText });
		}
	}
	if (control?.settings?.defaultModel?.trim()) {
		lines.push({ text: `Model: ${control.settings.defaultModel}`, fg: towerTheme.metaText });
	}
	if (control?.settings?.agentRuntime?.trim()) {
		lines.push({ text: `Configured runtime: ${control.settings.agentRuntime}`, fg: towerTheme.metaText });
	}

	return lines;
}

function buildControlLines(props: ControlStatusPanelProps): TabPanelLine[] {
	const control = props.control;
	if (!control) {
		return [
			{ text: 'Waiting for daemon control status...', fg: towerTheme.mutedText }
		];
	}

	const lines: TabPanelLine[] = [
		{
			text: props.mode === 'setup'
				? 'Finish runtime setup before starting your first mission.'
				: 'Mission control is ready.',
			fg: towerTheme.brightText
		},
		{ text: `Opened from ${props.workspaceContextLabel}.`, fg: towerTheme.metaText },
		{ text: '', fg: towerTheme.metaText },
		{
			text: `Repo control here: ${control.initialized ? 'present' : 'deferred'} | Settings: ${control.settingsComplete ? 'ready' : 'needs attention'} | Issue intake: ${issueStatusLabel(control)}`,
			fg: towerTheme.metaText
		},
		{
			text: `GitHub auth: ${githubStatusLabel(control)} | Active missions: ${String(control.availableMissionCount)}`,
			fg: towerTheme.metaText
		}
	];

	if (control.githubRepository) {
		lines.push({ text: `GitHub repository: ${control.githubRepository}`, fg: towerTheme.metaText });
	}

	const notices = [...control.problems, ...control.warnings].slice(0, 3);
	for (const notice of notices) {
		lines.push({ text: `* ${humanizeControlNotice(notice)}`, fg: towerTheme.warning });
	}

	if (props.availableMissions.length === 0) {
		lines.push({
			text: props.mode === 'setup'
				? 'No active missions yet. Finish runtime setup, then create your first mission with /start.'
				: 'No active missions yet. Use /start from the repository root to create your first mission.',
			fg: towerTheme.mutedText
		});
		return lines;
	}

	lines.push({ text: 'Missions:', fg: towerTheme.labelText });
	for (const candidate of props.availableMissions.slice(0, 6)) {
		lines.push({ text: formatMissionLine(candidate), fg: towerTheme.metaText });
	}

	return lines;
}

function sessionStateColor(lifecycleState: MissionAgentSessionRecord['lifecycleState']): string {
	if (lifecycleState === 'starting' || lifecycleState === 'running' || lifecycleState === 'awaiting-input') {
		return towerTheme.success;
	}
	if (lifecycleState === 'idle') {
		return towerTheme.warning;
	}
	return towerTheme.danger;
}

function issueStatusLabel(control: MissionControlPlaneStatus): string {
	if (!control.issuesConfigured) {
		return 'not ready';
	}
	if (control.githubAuthenticated === false) {
		return 'waiting for GitHub auth';
	}
	if (control.githubAuthenticated === true) {
		return 'ready';
	}
	return 'preparing';
}

function githubStatusLabel(control: MissionControlPlaneStatus): string {
	if (control.githubAuthenticated === true) {
		return 'ok';
	}
	if (control.githubAuthenticated === false) {
		return 'required';
	}
	return 'n/a';
}

function humanizeControlNotice(entry: string): string {
	if (entry === 'Mission could not resolve a GitHub repository from the current workspace.') {
		return 'Mission could not detect a GitHub repository from the current workspace.';
	}
	if (entry === 'Mission control will be created in the first mission worktree if it is not already present on this checkout.') {
		return 'Local repo-control files are optional until the first mission worktree is created.';
	}
	return entry;
}

function formatMissionLine(candidate: MissionSelectionCandidate): string {
	const issueLabel = candidate.issueId !== undefined ? `#${String(candidate.issueId)} ` : '';
	return `${issueLabel}${candidate.missionId} | ${candidate.branchRef}`;
}
