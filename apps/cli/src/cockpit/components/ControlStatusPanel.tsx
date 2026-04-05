/** @jsxImportSource @opentui/solid */

import type {
	MissionAgentSessionRecord,
	MissionControlPlaneStatus,
	MissionSelectionCandidate
} from '@flying-pillow/mission-core';
import { createMemo } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { TabPanel, type TabPanelLine } from './TabPanel.js';

type ControlStatusPanelProps = {
	mode: 'setup' | 'root';
	control: MissionControlPlaneStatus | undefined;
	controlSession: MissionAgentSessionRecord | undefined;
	sessionOutputLines: string[];
	selectedTabId?: 'agentrunner' | 'control';
	focused: boolean;
	tabsFocusable: boolean;
	bodyRows: number;
	availableMissions: MissionSelectionCandidate[];
	workspaceContextLabel: string;
};

export function ControlStatusPanel(props: ControlStatusPanelProps) {
	const runnerLabel = createMemo(() => {
		const runtimeId = props.controlSession?.runtimeId?.trim() || props.control?.settings?.agentRunner?.trim() || 'agentrunner';
		return runtimeId.toUpperCase();
	});
	const selectedTabId = createMemo<'agentrunner' | 'control'>(() => {
		if (props.selectedTabId) {
			return props.selectedTabId;
		}
		return props.controlSession ? 'agentrunner' : 'control';
	});

	const bodyLines = createMemo<TabPanelLine[]>(() => {
		if (selectedTabId() === 'agentrunner') {
			return buildAgentRunnerLines(props);
		}
		return buildControlLines(props);
	});

	return (
		<TabPanel
			focused={props.focused}
			tabs={[
				{ id: 'agentrunner', label: runnerLabel() },
				{ id: 'control', label: 'CONTROL' }
			]}
			selectedTabId={selectedTabId()}
			tabsFocusable={props.tabsFocusable}
			bodyLines={bodyLines()}
			bodyRows={Math.max(6, props.bodyRows)}
		/>
	);
}

function buildAgentRunnerLines(props: ControlStatusPanelProps): TabPanelLine[] {
	const control = props.control;
	const session = props.controlSession;
	const lines: TabPanelLine[] = [
		{ text: 'Agent runner connection for repository root.', fg: cockpitTheme.brightText },
		{ text: `Opened from ${props.workspaceContextLabel}.`, fg: cockpitTheme.metaText },
		{ text: '', fg: cockpitTheme.metaText }
	];

	if (!session) {
		lines.push({ text: 'No active agentrunner session.', fg: cockpitTheme.warning });
		lines.push({ text: 'Use /launch to start the configured runtime.', fg: cockpitTheme.metaText });
		if (!control?.settingsComplete) {
			lines.push({ text: 'Setup incomplete. Use /setup first.', fg: cockpitTheme.warning });
		}
		return lines;
	}

	lines.push({ text: `Runtime: ${session.runtimeId}`, fg: cockpitTheme.metaText });
	lines.push({ text: `State: ${session.lifecycleState}`, fg: sessionStateColor(session.lifecycleState) });
	lines.push({ text: '', fg: cockpitTheme.metaText });
	lines.push({ text: 'Live output:', fg: cockpitTheme.labelText });
	if (props.sessionOutputLines.length === 0) {
		lines.push({ text: 'No output has been recorded for this session yet.', fg: cockpitTheme.secondaryText });
	} else {
		for (const line of props.sessionOutputLines) {
			lines.push({ text: line, fg: cockpitTheme.bodyText });
		}
	}
	if (control?.settings?.defaultModel?.trim()) {
		lines.push({ text: `Model: ${control.settings.defaultModel}`, fg: cockpitTheme.metaText });
	}
	if (control?.settings?.agentRunner?.trim()) {
		lines.push({ text: `Configured runner: ${control.settings.agentRunner}`, fg: cockpitTheme.metaText });
	}

	return lines;
}

function buildControlLines(props: ControlStatusPanelProps): TabPanelLine[] {
	const control = props.control;
	if (!control) {
		return [
			{ text: 'Waiting for daemon control status...', fg: cockpitTheme.mutedText }
		];
	}

	const lines: TabPanelLine[] = [
		{
			text: props.mode === 'setup'
				? 'Finish setup before starting your first mission.'
				: 'Mission control is ready.',
			fg: cockpitTheme.brightText
		},
		{ text: `Opened from ${props.workspaceContextLabel}.`, fg: cockpitTheme.metaText },
		{ text: '', fg: cockpitTheme.metaText },
		{
			text: `Files: ${control.initialized ? 'ready' : 'missing'} | Settings: ${control.settingsComplete ? 'ready' : 'needs attention'} | Issue intake: ${issueStatusLabel(control)}`,
			fg: cockpitTheme.metaText
		},
		{
			text: `GitHub auth: ${githubStatusLabel(control)} | Active missions: ${String(control.availableMissionCount)}`,
			fg: cockpitTheme.metaText
		}
	];

	if (control.githubRepository) {
		lines.push({ text: `GitHub repository: ${control.githubRepository}`, fg: cockpitTheme.metaText });
	}

	const notices = [...control.problems, ...control.warnings].slice(0, 3);
	for (const notice of notices) {
		lines.push({ text: `* ${humanizeControlNotice(notice)}`, fg: cockpitTheme.warning });
	}

	if (props.availableMissions.length === 0) {
		lines.push({
			text: props.mode === 'setup'
				? 'No active missions yet. Finish setup, then create your first mission with /start.'
				: 'No active missions yet. Use /start from the repository root to create your first mission.',
			fg: cockpitTheme.mutedText
		});
		return lines;
	}

	lines.push({ text: 'Missions:', fg: cockpitTheme.labelText });
	for (const candidate of props.availableMissions.slice(0, 6)) {
		lines.push({ text: formatMissionLine(candidate), fg: cockpitTheme.metaText });
	}

	return lines;
}

function sessionStateColor(lifecycleState: MissionAgentSessionRecord['lifecycleState']): string {
	if (lifecycleState === 'starting' || lifecycleState === 'running' || lifecycleState === 'awaiting-input') {
		return cockpitTheme.success;
	}
	if (lifecycleState === 'idle') {
		return cockpitTheme.warning;
	}
	return cockpitTheme.danger;
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
	if (entry === 'Mission control scaffolding is missing.') {
		return 'Mission control files are missing.';
	}
	if (entry === 'Mission settings are missing.') {
		return 'Mission settings are missing.';
	}
	return entry;
}

function formatMissionLine(candidate: MissionSelectionCandidate): string {
	const issueLabel = candidate.issueId !== undefined ? `#${String(candidate.issueId)} ` : '';
	return `${issueLabel}${candidate.missionId} | ${candidate.branchRef}`;
}
