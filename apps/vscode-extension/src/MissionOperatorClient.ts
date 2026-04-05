import * as vscode from 'vscode';
import {
	bootstrapMissionFromIssue,
	connectDaemonClient,
	executeCommand,
	evaluateMissionGate,
	getControlStatus,
	getMissionStatus,
	listOpenGitHubIssues,
	resolveDaemonLaunchModeFromModule,
	selectorFromStatus,
	type MissionSelector,
	type MissionStatus,
	type MissionStageId,
	type DaemonClient,
	type Notification
} from '@flying-pillow/mission-core';
import type {
	MissionGitHubIssue,
	MissionGateIntent
} from './MissionModels.js';
import { MissionWorkspaceResolver } from './MissionWorkspaceResolver.js';

export class MissionOperatorClient implements vscode.Disposable {
	private daemonClient?: DaemonClient;
	private daemonClientSubscription?: { dispose(): void };
	private readonly missionStatusEmitter = new vscode.EventEmitter<MissionStatus>();
	private readonly notificationEmitter = new vscode.EventEmitter<Notification>();
	private lastStatus?: MissionStatus;
	private connectedWorkspaceRoot?: string;
	private selectorState: MissionSelector = {};

	public constructor(private readonly outputChannel: vscode.OutputChannel) { }

	public readonly onDidMissionStatusChange = this.missionStatusEmitter.event;
	public readonly onDidNotification = this.notificationEmitter.event;

	public dispose(): void {
		this.daemonClientSubscription?.dispose();
		this.daemonClientSubscription = undefined;
		this.daemonClient?.dispose();
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
		const client = await this.getClient();
		const workspaceMissionId =
			workspaceResolution?.workspaceContext.kind === 'mission-worktree'
				? workspaceResolution.workspaceContext.missionId
				: undefined;
		const missionId = workspaceMissionId ?? this.selectorState.missionId ?? this.lastStatus?.missionId;
		const discoveryStatus = await getControlStatus(client);
		const status = missionId
			? await getMissionStatus(client, { missionId })
			: discoveryStatus;
		this.updateStatus(status);
		return status;
	}

	public async bootstrapMissionFromIssue(issueNumber: number): Promise<MissionStatus> {
		const status = await bootstrapMissionFromIssue(await this.getClient(), issueNumber);
		this.updateStatus(status);
		return status;
	}

	public async evaluateGate(intent: MissionGateIntent) {
		return evaluateMissionGate(await this.getClient(), this.requireMissionSelector(), intent);
	}

	public async transitionMissionStage(toStage: MissionStageId): Promise<MissionStatus> {
		const result = await executeCommand(await this.getClient(), {
			commandId: `stage.transition.${toStage}`,
			selector: this.requireMissionSelector(),
			steps: []
		});
		const status = result.status;
		if (!status) {
			throw new Error(`Mission stage '${toStage}' did not return an updated mission status.`);
		}
		this.updateStatus(status);
		return status;
	}

	public async deliverMission(): Promise<MissionStatus> {
		const result = await executeCommand(await this.getClient(), {
			commandId: 'mission.deliver',
			selector: this.requireMissionSelector(),
			steps: []
		});
		const status = result.status;
		if (!status) {
			throw new Error('Mission delivery did not return an updated mission status.');
		}
		this.updateStatus(status);
		return status;
	}

	public async listOpenGitHubIssues(limit = 50): Promise<MissionGitHubIssue[]> {
		return listOpenGitHubIssues(await this.getClient(), limit);
	}

	private async getClient(): Promise<DaemonClient> {
		const workspaceResolution = await MissionWorkspaceResolver.resolveWorkspaceContext();
		const workspaceRoot = workspaceResolution?.workspaceRoot;
		if (!workspaceRoot) {
			throw new Error('Mission could not resolve an operational workspace root.');
		}

		if (this.daemonClient && this.connectedWorkspaceRoot === workspaceRoot) {
			return this.daemonClient;
		}

		if (this.daemonClient) {
			this.daemonClientSubscription?.dispose();
			this.daemonClientSubscription = undefined;
			this.daemonClient.dispose();
			this.daemonClient = undefined;
			this.connectedWorkspaceRoot = undefined;
			this.selectorState = {};
			this.lastStatus = undefined;
		}

		this.outputChannel.appendLine(
			`Mission connecting daemon client for ${workspaceRoot} (${workspaceResolution.workspaceContext.kind === 'mission-worktree' ? `worktree ${workspaceResolution.workspaceContext.missionId}` : 'control-root'}).`
		);
		const daemonClient = await connectDaemonClient({
			surfacePath: workspaceResolution.resolvedPath,
			preferredLaunchMode: resolveDaemonLaunchModeFromModule(import.meta.url)
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
		this.daemonClient = daemonClient;
		this.connectedWorkspaceRoot = workspaceRoot;
		return daemonClient;
	}

	private requireMissionSelector(): MissionSelector {
		const missionId = this.selectorState.missionId ?? this.lastStatus?.missionId;
		if (!missionId) {
			throw new Error('Mission operations require an explicit mission selection.');
		}
		return { missionId };
	}

	private updateStatus(status: MissionStatus): void {
		this.selectorState = selectorFromStatus(status);
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
