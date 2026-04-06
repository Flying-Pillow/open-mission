import * as vscode from 'vscode';
import { MissionCockpitViewProvider } from './MissionCockpitViewProvider.js';
import { MissionLogChannel } from './MissionLogChannel.js';
import { MissionLogViewProvider } from './MissionLogViewProvider.js';
import { MissionOperatorClient } from './MissionOperatorClient.js';
import { MissionSessionController } from './MissionSessionController.js';
import { MissionTreeDataProvider } from './MissionTreeView.js';
import {
	isMissionArtifactKey,
	isMissionGateIntent,
	type MissionArtifactDispositionAction,
	type MissionArtifactPreparationAction,
	type MissionArtifactReference,
	type MissionTaskExecutionAction
} from './MissionModels.js';

const ACTIVATION_STATE_KEY = '__missionActivationState';

async function registerCommandSafely(
	commandId: string,
	handler: (...args: unknown[]) => unknown,
	outputChannel: { appendLine(value: string): void }
): Promise<vscode.Disposable | undefined> {
	const existingCommands = await vscode.commands.getCommands(true);
	if (existingCommands.includes(commandId)) {
		outputChannel.appendLine(
			`Mission skipped duplicate command registration for '${commandId}'.`
		);
		return undefined;
	}

	return vscode.commands.registerCommand(commandId, handler);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const activationState = globalThis as typeof globalThis & {
		[ACTIVATION_STATE_KEY]?: { active: boolean };
	};
	if (activationState[ACTIVATION_STATE_KEY]?.active) {
		return;
	}
	activationState[ACTIVATION_STATE_KEY] = { active: true };

	const outputChannel = new MissionLogChannel('Mission');
	context.subscriptions.push(
		new vscode.Disposable(() => {
			delete activationState[ACTIVATION_STATE_KEY];
		})
	);

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	const extensionVersion = String(context.extension.packageJSON.version ?? 'unknown');
	const operatorClient = new MissionOperatorClient(outputChannel);
	const sessionController = new MissionSessionController(
		operatorClient,
		statusBarItem,
		outputChannel
	);
	const cockpitViewProvider = new MissionCockpitViewProvider(
		context.extensionUri,
		sessionController
	);
	const logViewProvider = new MissionLogViewProvider(outputChannel);
	const treeDataProvider = new MissionTreeDataProvider(sessionController);
	const overviewTree = vscode.window.createTreeView('mission.overview', {
		treeDataProvider,
		showCollapseAll: true
	});
	const cockpitProviderRegistration = vscode.window.registerWebviewViewProvider(
		'mission.cockpit',
		cockpitViewProvider
	);
	const logProviderRegistration = vscode.window.registerWebviewViewProvider(
		'mission.log',
		logViewProvider
	);

	outputChannel.appendLine(
		`Mission activated. Version=${extensionVersion}. Filesystem mission model enabled.`
	);
	statusBarItem.show();
	context.subscriptions.push(
		outputChannel,
		statusBarItem,
		sessionController,
		cockpitViewProvider,
		logViewProvider,
		treeDataProvider,
		overviewTree,
		cockpitProviderRegistration,
		logProviderRegistration
	);
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			void sessionController.refresh();
		}),
		vscode.workspace.onDidChangeConfiguration(() => {
			void sessionController.refresh();
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void sessionController.refresh();
		})
	);

	const commandDisposables = await Promise.all([
		registerCommandSafely('mission.showStatus', async () => {
			await sessionController.showStatus();
		}, outputChannel),
		registerCommandSafely('mission.openSettings', async () => {
			await vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'@ext:mission.mission'
			);
		}, outputChannel),
		registerCommandSafely('mission.openMissionFolder', async () => {
			await sessionController.openMissionFolder();
		}, outputChannel),
		registerCommandSafely('mission.openMissionArtifact', async (input?: unknown) => {
			await sessionController.openMissionArtifact(parseArtifactReference(input));
		}, outputChannel),
		registerCommandSafely('mission.editMissionArtifact', async (input?: unknown) => {
			await sessionController.editMissionArtifact(parseArtifactReference(input));
		}, outputChannel),
		registerCommandSafely('mission.openMissionChat', async () => {
			await sessionController.openMissionChat();
		}, outputChannel),
		registerCommandSafely('mission.intakeGitHubIssue', async () => {
			await sessionController.intakeGitHubIssue();
		}, outputChannel),
		registerCommandSafely('mission.prepareMissionArtifact', async (input?: unknown) => {
			const action = parseArtifactPreparationAction(input);
			if (!action) {
				throw new Error('mission.prepareMissionArtifact requires an artifactKey payload.');
			}
			await sessionController.prepareMissionArtifact(action);
		}, outputChannel),
		registerCommandSafely('mission.executeMissionSlice', async (input?: unknown) => {
			await sessionController.executeMissionSlice(parseTaskExecutionAction(input));
		}, outputChannel),
		registerCommandSafely(
			'mission.setMissionArtifactDisposition',
			async (input?: unknown) => {
				await sessionController.setMissionArtifactDisposition(
					parseArtifactDispositionAction(input)
				);
			},
			outputChannel
		),
		registerCommandSafely('mission.createIntermediateCommit', async () => {
			await sessionController.createIntermediateCommit();
		}, outputChannel),
		registerCommandSafely('mission.openMissionTimeline', async () => {
			await vscode.window.showInformationMessage(
				'The timeline webview was removed from the reduced extension host.'
			);
		}, outputChannel),
		registerCommandSafely('mission.refreshStatus', async () => {
			await sessionController.refresh();
		}, outputChannel),
		registerCommandSafely('mission.checkImplementationGate', async () => {
			await sessionController.showImplementationGate();
		}, outputChannel),
		registerCommandSafely('mission.previewGateIntent', async (intent?: unknown) => {
			if (intent !== undefined && !isMissionGateIntent(intent)) {
				throw new Error('mission.previewGateIntent received an invalid gate intent payload.');
			}
			await sessionController.showGatePreview(isMissionGateIntent(intent) ? intent : undefined);
		}, outputChannel)
	]);
	for (const disposable of commandDisposables) {
		if (disposable) {
			context.subscriptions.push(disposable);
		}
	}

	await sessionController.refresh();
}

export function deactivate(): void { }

function parseArtifactReference(input: unknown): MissionArtifactReference | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const candidate = input as { artifactKey?: unknown; artifactPath?: unknown };
	return {
		...(isMissionArtifactKey(candidate.artifactKey) ? { artifactKey: candidate.artifactKey } : {}),
		...(typeof candidate.artifactPath === 'string' ? { artifactPath: candidate.artifactPath } : {})
	};
}

function parseArtifactPreparationAction(input: unknown): MissionArtifactPreparationAction | undefined {
	const reference = parseArtifactReference(input);
	if (!reference?.artifactKey) {
		return undefined;
	}
	return {
		artifactKey: reference.artifactKey,
		...(reference.artifactPath ? { artifactPath: reference.artifactPath } : {})
	};
}

function parseTaskExecutionAction(input: unknown): MissionTaskExecutionAction | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const candidate = input as { taskId?: unknown; taskPath?: unknown; label?: unknown; source?: unknown };
	return {
		...(typeof candidate.taskId === 'string' ? { taskId: candidate.taskId } : {}),
		...(typeof candidate.taskPath === 'string' ? { taskPath: candidate.taskPath } : {}),
		...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
		...(typeof candidate.source === 'string' ? { source: candidate.source } : {})
	};
}

function parseArtifactDispositionAction(input: unknown): MissionArtifactDispositionAction | undefined {
	const reference = parseArtifactReference(input);
	if (!reference?.artifactKey) {
		return undefined;
	}
	return { artifactKey: reference.artifactKey };
}
