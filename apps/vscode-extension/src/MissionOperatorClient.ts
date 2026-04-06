import * as vscode from 'vscode';
import {
	DaemonApi,
	DaemonMissionApi,
	type MissionActionExecutionStep,
	type MissionActionDescriptor,
	type MissionSelector,
	type MissionStatus,
	type DaemonClient,
	type Notification
} from '@flying-pillow/mission-core';
import {
	connectMissionDaemon,
	resolveMissionDaemonLaunchMode
} from './daemonLifecycle.js';
import type {
	MissionGitHubIssue,
	MissionGateIntent
} from './MissionModels.js';
import type { MissionLogWriter } from './MissionLogChannel.js';
import { MissionWorkspaceResolver } from './MissionWorkspaceResolver.js';

export class MissionOperatorClient implements vscode.Disposable {
	private daemonApi?: DaemonApi;
	private daemonClient?: DaemonClient;
	private daemonClientSubscription?: { dispose(): void };
	private readonly missionStatusEmitter = new vscode.EventEmitter<MissionStatus>();
	private readonly notificationEmitter = new vscode.EventEmitter<Notification>();
	private lastStatus?: MissionStatus;
	private connectedWorkspaceRoot?: string;
	private selectorState: MissionSelector = {};

	public constructor(private readonly outputChannel: MissionLogWriter) { }

	public readonly onDidMissionStatusChange = this.missionStatusEmitter.event;
	public readonly onDidNotification = this.notificationEmitter.event;

	public dispose(): void {
		this.daemonClientSubscription?.dispose();
		this.daemonClientSubscription = undefined;
		this.daemonClient?.dispose();
		this.daemonApi = undefined;
		this.daemonClient = undefined;
		this.connectedWorkspaceRoot = undefined;
		this.selectorState = {};
		this.missionStatusEmitter.dispose();
		this.notificationEmitter.dispose();
	}

	public async getMissionStatus(): Promise<MissionStatus> {
		return this.lastStatus ?? this.refreshMissionStatus();
	}

	public async refreshMissionStatus(): Promise<MissionStatus> {
		const workspaceResolution = await MissionWorkspaceResolver.resolveWorkspaceContext();
		const api = await this.getApi();
		const workspaceMissionId =
			workspaceResolution?.workspaceContext.kind === 'mission-worktree'
				? workspaceResolution.workspaceContext.missionId
				: undefined;
		const missionId = workspaceMissionId ?? this.selectorState.missionId ?? this.lastStatus?.missionId;
		const discoveryStatus = await api.control.getStatus();
		const status = missionId
			? await api.mission.getStatus({ missionId })
			: discoveryStatus;
		this.updateStatus(status);
		return status;
	}

	public async requestMissionFromIssue(issueNumber: number): Promise<MissionStatus> {
		const status = await (await this.getApi()).mission.fromIssue(issueNumber);
		this.updateStatus(status);
		return status;
	}

	public async evaluateGate(intent: MissionGateIntent) {
		return (await this.getApi()).mission.evaluateGate(this.requireMissionSelector(), intent);
	}

	public async listAvailableActions(
		selector?: MissionSelector
	): Promise<MissionActionDescriptor[]> {
		const api = await this.getApi();
		const missionSelector = selector ?? this.requireMissionSelectorIfPresent();
		return missionSelector
			? api.mission.listAvailableActions(missionSelector)
			: api.control.listAvailableActions();
	}

	public async executeAction(
		commandId: string,
		steps: MissionActionExecutionStep[] = [],
		selector?: MissionSelector
	): Promise<MissionStatus> {
		const api = await this.getApi();
		const missionSelector = selector ?? this.requireMissionSelectorIfPresent();
		const status = missionSelector
			? await api.mission.executeAction(missionSelector, commandId, steps)
			: await api.control.executeAction(commandId, steps);
		this.updateStatus(status);
		return status;
	}

	public async listOpenGitHubIssues(limit = 50): Promise<MissionGitHubIssue[]> {
		return (await this.getApi()).control.listOpenIssues(limit);
	}

	private async getApi(): Promise<DaemonApi> {
		const workspaceResolution = await MissionWorkspaceResolver.resolveWorkspaceContext();
		const workspaceRoot = workspaceResolution?.workspaceRoot;
		if (!workspaceRoot) {
			throw new Error('Mission could not resolve an operational workspace root.');
		}

		if (this.daemonApi && this.daemonClient && this.connectedWorkspaceRoot === workspaceRoot) {
			return this.daemonApi;
		}

		if (this.daemonClient) {
			this.daemonClientSubscription?.dispose();
			this.daemonClientSubscription = undefined;
			this.daemonClient.dispose();
			this.daemonApi = undefined;
			this.daemonClient = undefined;
			this.connectedWorkspaceRoot = undefined;
			this.selectorState = {};
			this.lastStatus = undefined;
		}

		this.outputChannel.appendLine(
			`Mission connecting daemon client for ${workspaceRoot} (${workspaceResolution.workspaceContext.kind === 'mission-worktree' ? `worktree ${workspaceResolution.workspaceContext.missionId}` : 'control-root'}).`
		);
		const daemonClient = await connectMissionDaemon({
			surfacePath: workspaceResolution.resolvedPath,
			launchMode: resolveMissionDaemonLaunchMode(import.meta.url),
			logLine: (line) => {
				this.outputChannel.appendLine(line);
			}
		});
		this.daemonClientSubscription = daemonClient.onDidEvent((event) => {
			this.notificationEmitter.fire(event);
			const selectedMissionId = this.selectorState.missionId ?? this.lastStatus?.missionId;
			if (event.type === 'mission.status') {
				if (!selectedMissionId) {
					void this.refreshMissionStatus().catch((error: unknown) => {
						this.outputChannel.appendLine(`Mission refresh failed: ${toErrorMessage(error)}`);
					});
					return;
				}
				if (!shouldAcceptMissionEvent(selectedMissionId, event.missionId)) {
					return;
				}
				this.updateStatus(event.status);
				return;
			}
			if (event.type === 'session.event' || event.type === 'session.lifecycle') {
				if (selectedMissionId && !shouldAcceptMissionEvent(selectedMissionId, event.missionId)) {
					return;
				}
				void this.refreshMissionStatus().catch((error: unknown) => {
					this.outputChannel.appendLine(`Mission refresh failed: ${toErrorMessage(error)}`);
				});
			}
		});
		this.daemonApi = new DaemonApi(daemonClient);
		this.daemonClient = daemonClient;
		this.connectedWorkspaceRoot = workspaceRoot;
		return this.daemonApi;
	}

	private requireMissionSelector(): MissionSelector {
		const missionId = this.selectorState.missionId ?? this.lastStatus?.missionId;
		if (!missionId) {
			throw new Error('Mission operations require an explicit mission selection.');
		}
		return { missionId };
	}

	private requireMissionSelectorIfPresent(): MissionSelector | undefined {
		const missionId = this.selectorState.missionId ?? this.lastStatus?.missionId;
		return missionId ? { missionId } : undefined;
	}

	private updateStatus(status: MissionStatus): void {
		this.selectorState = DaemonMissionApi.selectorFromStatus(status);
		this.lastStatus = status;
		this.missionStatusEmitter.fire(status);
	}
}

function shouldAcceptMissionEvent(
	selectedMissionId: string | undefined,
	eventMissionId: string
): boolean {
	return selectedMissionId !== undefined && selectedMissionId === eventMissionId;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
