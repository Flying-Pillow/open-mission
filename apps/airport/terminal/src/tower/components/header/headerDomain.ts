import path from 'node:path';
import type {
	MissionSelectionCandidate,
	MissionTowerStageRailItemState,
	OperatorStatus,
	SystemStatus
} from '@flying-pillow/mission-core';
import { towerTheme } from '../towerTheme.js';

export type HeaderTab = {
	id: string;
	label: string;
	target: { kind: 'repository' } | { kind: 'mission'; missionId: string };
};

export type ProgressRailItemState = MissionTowerStageRailItemState;

export type ProgressRailItem = {
	id: string;
	label: string;
	state: ProgressRailItemState;
	selected: boolean;
	subtitle?: string;
};

type HeaderMissionSummary = {
	typeLabel: string;
	numberLabel: string;
	title: string;
};

type HeaderLine = { segments: Array<{ text: string; fg: string }> };
type HeaderBadge = { text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; framed?: boolean };

export const repositoryTabId = 'repository';

export function buildHeaderTabs(
	status: OperatorStatus,
	missionCandidates: MissionSelectionCandidate[] = []
): HeaderTab[] {
	const tabs: HeaderTab[] = [];
	const seenMissionIds = new Set<string>();
	const activeMissionId = status.missionId?.trim();
	if (activeMissionId) {
		const activeMissionTitle = missionCandidates.find(
			(candidate) => candidate.missionId === activeMissionId
		)?.title || activeMissionId;
		tabs.push({
			id: `mission:${activeMissionId}`,
			label: formatHeaderMissionLabel(
				activeMissionId,
				missionCandidates.find((candidate) => candidate.missionId === activeMissionId)?.issueId,
				activeMissionTitle
			),
			target: { kind: 'mission', missionId: activeMissionId }
		});
		seenMissionIds.add(activeMissionId);
	}
	for (const candidate of missionCandidates) {
		if (!candidate.missionId || seenMissionIds.has(candidate.missionId)) {
			continue;
		}
		tabs.push({
			id: `mission:${candidate.missionId}`,
			label: formatHeaderMissionLabel(candidate.missionId, candidate.issueId, candidate.title),
			target: { kind: 'mission', missionId: candidate.missionId }
		});
		seenMissionIds.add(candidate.missionId);
	}
	tabs.push({
		id: repositoryTabId,
		label: 'REPOSITORY',
		target: { kind: 'repository' }
	});
	return tabs;
}

export function pickPreferredHeaderTabId(
	tabs: HeaderTab[],
	current: string | undefined,
	active: string
): string | undefined {
	if (tabs.length === 0) {
		return undefined;
	}
	if (current && tabs.some((tab) => tab.id === current)) {
		return current;
	}
	if (tabs.some((tab) => tab.id === active)) {
		return active;
	}
	return tabs[0]?.id;
}

export function moveHeaderTabSelection(
	tabs: HeaderTab[],
	current: string | undefined,
	delta: number
): string | undefined {
	if (tabs.length === 0) {
		return undefined;
	}
	const currentId = current && tabs.some((tab) => tab.id === current) ? current : tabs[0]?.id;
	const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === currentId));
	const nextIndex = clampIndex(currentIndex + delta, tabs.length);
	return tabs[nextIndex]?.id;
}

export function buildHeaderStatusLines(
	status: OperatorStatus,
	workspaceRoot: string,
	selectedTab: HeaderTab | undefined,
	missionCandidates: MissionSelectionCandidate[] = []
): HeaderLine[] {
	const workspaceBaseName = path.basename(workspaceRoot.trim());
	const repository = resolvedControlGitHubRepository(status.control)
		?? (workspaceBaseName.length > 0 ? workspaceBaseName : 'workspace');
	const normalizedWorkspaceRoot = workspaceRoot.trim() || 'workspace';
	const repositoryLine = {
		segments: [
			{ text: ` ${repository}`, fg: towerTheme.accent },
			{ text: ' | ', fg: towerTheme.metaText },
			{ text: normalizedWorkspaceRoot, fg: towerTheme.metaText }
		]
	};
	const missionSummary = resolveHeaderMissionSummary(status, selectedTab, missionCandidates);
	if (missionSummary) {
		return [
			{
				segments: [
					{ text: ` ${missionSummary.typeLabel} ${missionSummary.numberLabel}`, fg: towerTheme.accent },
					{ text: ' | ', fg: towerTheme.metaText },
					{ text: missionSummary.title, fg: towerTheme.primaryText }
				]
			},
			repositoryLine
		];
	}
	return [repositoryLine];
}

export function buildHeaderFooterBadges(input: {
	status: OperatorStatus;
	daemonState: 'connected' | 'degraded' | 'booting';
	systemStatus: SystemStatus | undefined;
}): HeaderBadge[] {
	const control = input.status.control;
	return [
		...buildControlHeaderGitHubBadges(control, input.systemStatus),
		{ text: '●', tone: daemonStateTone(input.daemonState), framed: false }
	];
}

export function resolveHeaderWorkspaceLabel(control: OperatorStatus['control'], workspaceRoot: string): string {
	const githubRepository = resolvedControlGitHubRepository(control);
	if (githubRepository) {
		return githubRepository;
	}
	const normalizedRoot = workspaceRoot.trim();
	return normalizedRoot.length > 0 ? normalizedRoot : 'workspace';
}

function formatHeaderMissionLabel(missionId: string, issueId?: number, title?: string): string {
	const summary = buildHeaderMissionSummary(missionId, issueId, title);
	return `${summary.typeLabel} ${summary.numberLabel}`;
}

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(length - 1, index));
}

function resolveHeaderMissionSummary(
	status: OperatorStatus,
	selectedTab: HeaderTab | undefined,
	missionCandidates: MissionSelectionCandidate[] = []
): HeaderMissionSummary | undefined {
	if (selectedTab?.target.kind === 'repository') {
		return undefined;
	}
	const selectedMissionId = selectedTab?.target.kind === 'mission'
		? selectedTab.target.missionId
		: status.missionId;
	if (!selectedMissionId) {
		return undefined;
	}
	const missionCandidate = missionCandidates
		.find((candidate) => candidate.missionId === selectedMissionId);
	return buildHeaderMissionSummary(
		selectedMissionId,
		missionCandidate?.issueId,
		missionCandidate?.title
	);
}

function buildHeaderMissionSummary(
	missionId: string,
	issueId?: number,
	title?: string
): HeaderMissionSummary {
	const normalizedTitle = normalizeHeaderMissionTitle(title, missionId);
	if (issueId !== undefined) {
		return {
			typeLabel: 'ISSUE',
			numberLabel: String(issueId),
			title: normalizedTitle
		};
	}
	return {
		typeLabel: 'MISSION',
		numberLabel: extractHeaderMissionNumber(missionId),
		title: normalizedTitle
	};
}

function normalizeHeaderMissionTitle(title: string | undefined, missionId: string): string {
	const normalizedTitle = title?.replace(/\s+/gu, ' ').trim();
	return normalizedTitle && normalizedTitle.length > 0 ? normalizedTitle : missionId;
}

function extractHeaderMissionNumber(missionId: string): string {
	const leadingNumber = missionId.match(/^([0-9]+)/u)?.[1];
	if (leadingNumber) {
		return leadingNumber;
	}
	const branchNumber = missionId.match(/(?:^|\/)([0-9]+)(?:-|$)/u)?.[1];
	if (branchNumber) {
		return branchNumber;
	}
	return missionId;
}

function resolvedControlGitHubRepository(control: OperatorStatus['control']): string | undefined {
	if (!control || !('githubRepository' in control)) {
		return undefined;
	}
	const repository = control.githubRepository;
	return typeof repository === 'string' && repository.trim().length > 0 ? repository : undefined;
}

function buildControlHeaderGitHubBadges(
	control: OperatorStatus['control'],
	systemStatus?: SystemStatus
): HeaderBadge[] {
	if (control?.trackingProvider !== 'github') {
		return [];
	}
	const githubStatus = systemStatus?.github;
	if (!githubStatus) {
		return [{ text: 'github?', tone: 'neutral' }];
	}
	const githubUser = resolveHeaderGitHubUser(githubStatus.user);
	if (githubUser && githubUser.length > 0) {
		return [{ text: githubUser, tone: 'success' }];
	}
	if (githubStatus.authenticated) {
		return [{ text: 'github', tone: 'success' }];
	}
	return [{ text: 'github', tone: 'danger' }];
}

function resolveHeaderGitHubUser(githubUser?: string): string | undefined {
	const normalizedGitHubUser = githubUser?.trim();
	return normalizedGitHubUser && normalizedGitHubUser.length > 0 ? normalizedGitHubUser : undefined;
}

function daemonStateTone(state: 'connected' | 'degraded' | 'booting'): 'accent' | 'success' | 'warning' | 'danger' {
	if (state === 'connected') {
		return 'success';
	}
	if (state === 'booting') {
		return 'warning';
	}
	return 'danger';
}