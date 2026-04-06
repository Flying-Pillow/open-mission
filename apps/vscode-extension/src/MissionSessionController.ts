import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
	MissionActionExecutionStep,
	MissionActionDescriptor,
	MissionStageId
} from '@flying-pillow/mission-core';
import type {
	MissionChatRequest,
	MissionMissionSnapshot,
	MissionArtifactDispositionAction,
	MissionArtifactPreparationAction,
	MissionArtifactReference,
	MissionGateIntent,
	MissionTaskExecutionAction
} from './MissionModels.js';
import type { MissionLogWriter } from './MissionLogChannel.js';
import { MissionOperatorClient } from './MissionOperatorClient.js';

export class MissionSessionController implements vscode.Disposable {
	private readonly missionChangedEmitter = new vscode.EventEmitter<MissionMissionSnapshot>();
	private currentSnapshot: MissionMissionSnapshot = {
		status: { found: false }
	};
	private readonly disposables: vscode.Disposable[] = [];

	public constructor(
		private readonly operatorClient: MissionOperatorClient,
		private readonly statusBarItem: vscode.StatusBarItem,
		private readonly outputChannel: MissionLogWriter
	) {
		this.disposables.push(
			this.operatorClient.onDidMissionStatusChange((status) => {
				this.currentSnapshot = { status };
				this.updateStatusBar();
				this.missionChangedEmitter.fire(this.currentSnapshot);
			})
		);
		this.updateStatusBar();
	}

	public readonly onDidMissionStatusChange = this.missionChangedEmitter.event;

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.operatorClient.dispose();
		this.missionChangedEmitter.dispose();
	}

	public getSnapshot(): MissionMissionSnapshot {
		return {
			...this.currentSnapshot,
			status: { ...this.currentSnapshot.status }
		};
	}

	public async refresh(): Promise<void> {
		try {
			const status = await this.operatorClient.refreshMissionStatus();
			this.currentSnapshot = { status };
			this.updateStatusBar();
			this.missionChangedEmitter.fire(this.currentSnapshot);
		} catch (error) {
			this.currentSnapshot = {
				status: { found: false },
				errorMessage: toErrorMessage(error)
			};
			this.updateStatusBar();
			this.missionChangedEmitter.fire(this.currentSnapshot);
			this.outputChannel.appendLine(`Mission refresh failed: ${toErrorMessage(error)}`);
		}
	}

	public async showStatus(): Promise<void> {
		const status = await this.requireStatus();
		const currentStage = status.stages?.find((stage) => stage.stage === status.stage);
		const leadTask = status.activeTasks?.[0] ?? status.readyTasks?.[0];
		await vscode.window.showInformationMessage(
			[
				`Mission ${status.missionId ?? 'unknown'}`,
				`stage=${status.stage ?? 'unknown'}`,
				`branch=${status.branchRef ?? 'unknown'}`,
				`task=${leadTask?.subject ?? 'none'}`,
				currentStage
					? `progress=${String(currentStage.completedTaskCount)}/${String(currentStage.taskCount)}`
					: 'progress=0/0'
			].join(' | ')
		);
	}

	public async openMissionFolder(): Promise<void> {
		const status = await this.requireStatus();
		await this.switchToMissionWorkspace(status);
	}

	public async openMissionArtifact(reference?: MissionArtifactReference): Promise<void> {
		const uri = await this.resolveArtifactUri(reference);
		await vscode.window.showTextDocument(uri, { preview: false });
	}

	public async editMissionArtifact(reference?: MissionArtifactReference): Promise<void> {
		await this.openMissionArtifact(reference);
	}

	public async openMissionChat(_request?: MissionChatRequest): Promise<void> {
		await vscode.window.showInformationMessage(
			'Mission chat integration is not wired into the reduced extension host yet.'
		);
	}

	public async intakeGitHubIssue(): Promise<void> {
		const issueNumber = await vscode.window.showInputBox({
			prompt: 'GitHub issue number',
			placeHolder: '123'
		});
		if (!issueNumber) {
			return;
		}
		if (!/^\d+$/u.test(issueNumber.trim())) {
			throw new Error(`Invalid issue number '${issueNumber}'.`);
		}

		const status = await this.operatorClient.requestMissionFromIssue(Number(issueNumber.trim()));
		this.currentSnapshot = { status };
		this.updateStatusBar();
		this.missionChangedEmitter.fire(this.currentSnapshot);
		await this.switchToMissionWorkspace(status);
	}

	public async prepareMissionArtifact(action: MissionArtifactPreparationAction): Promise<void> {
		await this.openMissionArtifact({
			artifactKey: action.artifactKey,
			artifactPath: action.artifactPath
		});
	}

	public async executeMissionSlice(action?: MissionTaskExecutionAction): Promise<void> {
		const status = await this.requireStatus();
		const taskPath =
			action?.taskPath ?? status.activeTasks?.[0]?.filePath ?? status.readyTasks?.[0]?.filePath;
		if (!taskPath) {
			throw new Error('There is no active task file to open for this mission.');
		}
		await vscode.window.showTextDocument(vscode.Uri.file(taskPath), { preview: false });
	}

	public async setMissionArtifactDisposition(_action?: MissionArtifactDispositionAction): Promise<void> {
		await vscode.window.showWarningMessage(
			'Artifact dispositions were removed. Mission progress now lives in the mission.json control plane.'
		);
	}

	public async createIntermediateCommit(): Promise<void> {
		await vscode.window.showWarningMessage(
			'Intermediate commit automation was removed from the reduced extension host.'
		);
	}

	public getAvailableActions(): MissionActionDescriptor[] {
		return this.currentSnapshot.status.availableActions ?? [];
	}

	public async executeAction(
		commandId: string,
		steps: MissionActionExecutionStep[] = []
	): Promise<void> {
		const nextStatus = await this.operatorClient.executeAction(commandId, steps);
		this.currentSnapshot = { status: nextStatus };
		this.updateStatusBar();
		this.missionChangedEmitter.fire(this.currentSnapshot);
	}

	public async showImplementationGate(): Promise<void> {
		await this.showGatePreview('implement');
	}

	public async showGatePreview(intent?: MissionGateIntent): Promise<void> {
		const status = await this.requireStatus();
		const gateIntent = intent ?? defaultGateIntentForStage(status.stage);
		const result = await this.operatorClient.evaluateGate(gateIntent);
		const message = result.allowed
			? `Gate ${gateIntent} passed.`
			: `Gate ${gateIntent} blocked: ${result.errors.join(' | ')}`;
		await vscode.window.showInformationMessage(message);
	}

	private async requireStatus() {
		if (!this.currentSnapshot.status.found) {
			await this.refresh();
		}
		if (!this.currentSnapshot.status.found) {
			throw new Error(this.currentSnapshot.errorMessage ?? 'No active mission could be resolved.');
		}
		return this.currentSnapshot.status;
	}

	private async resolveArtifactUri(reference?: MissionArtifactReference): Promise<vscode.Uri> {
		const status = await this.requireStatus();
		const artifactPath =
			reference?.artifactPath ??
			(reference?.artifactKey ? status.productFiles?.[reference.artifactKey] : undefined);
		if (!artifactPath) {
			throw new Error('The requested mission artifact could not be resolved.');
		}
		return vscode.Uri.file(artifactPath);
	}

	private updateStatusBar(): void {
		const status = this.currentSnapshot.status;
		if (!status.found) {
			this.statusBarItem.text = 'Mission: no mission';
			this.statusBarItem.tooltip = this.currentSnapshot.errorMessage ?? 'No active mission';
			this.statusBarItem.command = 'mission.showStatus';
			this.statusBarItem.show();
			return;
		}

		const activeStage = status.stages?.find((stage) => stage.stage === status.stage);
		this.statusBarItem.text = activeStage
			? `Mission: ${String(status.stage ?? 'unknown').toUpperCase()} ${String(activeStage.completedTaskCount)}/${String(activeStage.taskCount)}`
			: `Mission: ${String(status.stage ?? 'unknown').toUpperCase()}`;
		this.statusBarItem.tooltip = [
			status.title ?? status.missionId ?? 'Mission',
			status.activeTasks?.[0]?.subject ?? status.readyTasks?.[0]?.subject ?? 'No active task'
		].join('\n');
		this.statusBarItem.command = 'mission.showStatus';
		this.statusBarItem.show();
	}

	private async switchToMissionWorkspace(status: { missionDir?: string }): Promise<void> {
		if (!status.missionDir) {
			throw new Error('The selected mission does not expose a mission directory.');
		}

		const missionDir = path.resolve(status.missionDir);
		const workspaceAlreadyOpen = (vscode.workspace.workspaceFolders ?? []).some(
			(folder) => path.resolve(folder.uri.fsPath) === missionDir
		);
		if (workspaceAlreadyOpen) {
			return;
		}

		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(missionDir), false);
	}
}

function defaultGateIntentForStage(stage: MissionStageId | undefined): MissionGateIntent {
	if (stage === 'prd' || stage === 'spec') {
		return 'implement';
	}
	if (stage === 'implementation') {
		return 'verify';
	}
	if (stage === 'audit') {
		return 'audit';
	}
	return 'deliver';
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
