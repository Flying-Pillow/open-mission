/** @jsxImportSource @opentui/solid */

import type {
	MissionControlPlaneStatus,
	MissionSelectionCandidate
} from '@flying-pillow/mission-core';
import { For, Show } from 'solid-js';
import { Panel } from './Panel.js';
import { cockpitTheme } from './cockpitTheme.js';

type ControlStatusPanelProps = {
	mode: 'setup' | 'root';
	control: MissionControlPlaneStatus | undefined;
	availableMissions: MissionSelectionCandidate[];
	workspaceContextLabel: string;
};

export function ControlStatusPanel(props: ControlStatusPanelProps) {
	const control = () => props.control;
	return (
		<Panel
			title={props.mode === 'setup' ? 'SETUP' : 'CONTROL'}
			titleColor={cockpitTheme.title}
			backgroundColor={cockpitTheme.panelBackground}
			contentStyle={{ gap: 1 }}
		>
			<text style={{ fg: cockpitTheme.brightText }}>
				{props.mode === 'setup' ? 'Finish setup before starting your first mission.' : 'Mission control is ready.'}
			</text>
			<text style={{ fg: cockpitTheme.metaText }}>
				Opened from {props.workspaceContextLabel}.
			</text>
			<Show
				when={control()}
				fallback={<text style={{ fg: cockpitTheme.mutedText }}>Waiting for daemon control status...</text>}
			>
				{(resolvedControl) => (
					<>
						<text style={{ fg: cockpitTheme.labelText }}>STATUS</text>
						<text style={{ fg: cockpitTheme.metaText }}>
							Files: {resolvedControl().initialized ? 'ready' : 'missing'} | Settings: {resolvedControl().settingsComplete ? 'ready' : 'needs attention'} | Issue intake: {issueStatusLabel(resolvedControl())}
						</text>
						<text style={{ fg: cockpitTheme.metaText }}>
							GitHub auth: {githubStatusLabel(resolvedControl())} | Active missions: {String(resolvedControl().availableMissionCount)}
						</text>
						<Show when={resolvedControl().githubRepository}>
							<text style={{ fg: cockpitTheme.metaText }}>
								GitHub repository: {resolvedControl().githubRepository}
							</text>
						</Show>

						<Show when={resolvedControl().problems.length > 0 || resolvedControl().warnings.length > 0}>
							<text style={{ fg: cockpitTheme.labelText }}>ATTENTION</text>
							<Show when={props.mode === 'setup'}>
								<text style={{ fg: cockpitTheme.warning }}>Use /setup to configure Mission settings.</text>
							</Show>
							<For each={[...resolvedControl().problems, ...resolvedControl().warnings].slice(0, 4)}>
								{(entry) => <text style={{ fg: cockpitTheme.warning }}>{`* ${humanizeControlNotice(entry)}`}</text>}
							</For>
						</Show>

						<text style={{ fg: cockpitTheme.labelText }}>MISSIONS</text>
						<Show
							when={props.availableMissions.length > 0}
							fallback={
								<text style={{ fg: cockpitTheme.mutedText }}>
									{props.mode === 'setup'
										? 'No mission worktrees yet. Finish setup, then create your first mission with /start.'
										: 'No mission worktrees yet. Use /start from the repository root to create your first mission.'}
								</text>
							}
						>
							<For each={props.availableMissions.slice(0, 8)}>
								{(candidate) => (
									<text style={{ fg: cockpitTheme.metaText }}>
										{formatMissionLine(candidate)}
									</text>
								)}
							</For>
						</Show>
					</>
				)}
			</Show>
		</Panel>
	);
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