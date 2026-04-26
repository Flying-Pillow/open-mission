import * as path from 'node:path';
import {
	agentSessionSchema,
	missionRuntimeSnapshotSchema,
	missionStatusSummarySchema
} from '../../schemas/MissionRuntime.js';
import { createConfiguredAgentRunners } from '../../agent/runtimes/AgentRuntimeFactory.js';
import { readRepositorySettingsDocument } from '../../lib/daemonConfig.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import { Factory } from '../../mission/Factory.js';
import type { MissionRuntime } from '../../mission/Mission.js';
import { operatorStatusSchema } from '../../operator-status-schema.js';
import { normalizeWorkflowSettings } from '../../settings/validation.js';
import type { OperatorActionExecutionStep, OperatorStatus } from '../../types.js';
import { readMissionWorkflowDefinition } from '../../workflow/mission/preset.js';
import { createDefaultWorkflowSettings } from '../../workflow/mission/workflow.js';
import { createDefaultRepositorySettings } from '../../schemas/RepositorySettings.js';
import { Mission as MissionEntity } from './Mission.js';
import type {
	MissionCommandPayload,
	MissionExecuteActionPayload,
	MissionIdentityPayload,
	MissionSessionCommandPayload,
	MissionTaskCommandPayload
} from './MissionRemoteContract.js';

export class MissionRemote {
	public static async read(input: MissionIdentityPayload, context: { surfacePath: string }) {
		const mission = await loadMissionRuntime(input, context);
		try {
			return await buildMissionRuntimeSnapshot(mission, input.missionId);
		} finally {
			mission.dispose();
		}
	}

	public static async command(input: MissionCommandPayload, context: { surfacePath: string }) {
		const mission = await loadMissionRuntime(input, context);
		try {
			switch (input.command.action) {
				case 'pause':
					await mission.pauseMission();
					break;
				case 'resume':
					await mission.resumeMission();
					break;
				case 'panic':
					await mission.panicStopMission();
					break;
				case 'clearPanic':
					await mission.clearMissionPanic();
					break;
				case 'restartQueue':
					await mission.restartLaunchQueue();
					break;
				case 'deliver':
					await mission.deliver();
					break;
			}

			return await buildMissionRuntimeSnapshot(mission, input.missionId);
		} finally {
			mission.dispose();
		}
	}

	public static async taskCommand(input: MissionTaskCommandPayload, context: { surfacePath: string }) {
		const mission = await loadMissionRuntime(
			input,
			context,
			input.command.action === 'start' ? input.command.terminalSessionName : undefined
		);
		try {
			switch (input.command.action) {
				case 'start':
					await mission.startTask(
						input.taskId,
						input.command.terminalSessionName?.trim()
							? { terminalSessionName: input.command.terminalSessionName.trim() }
							: {}
					);
					break;
				case 'complete':
					await mission.completeTask(input.taskId);
					break;
				case 'reopen':
					await mission.reopenTask(input.taskId);
					break;
			}

			return await buildMissionRuntimeSnapshot(mission, input.missionId);
		} finally {
			mission.dispose();
		}
	}

	public static async sessionCommand(input: MissionSessionCommandPayload, context: { surfacePath: string }) {
		const mission = await loadMissionRuntime(input, context);
		try {
			switch (input.command.action) {
				case 'complete':
					await mission.completeAgentSession(input.sessionId);
					break;
				case 'cancel':
					await mission.cancelAgentSession(input.sessionId, input.command.reason);
					break;
				case 'terminate':
					await mission.terminateAgentSession(input.sessionId, input.command.reason);
					break;
				case 'prompt':
					await mission.sendAgentSessionPrompt(input.sessionId, normalizeAgentPrompt(input.command.prompt));
					break;
				case 'command':
					await mission.sendAgentSessionCommand(input.sessionId, normalizeAgentCommand(input.command.command));
					break;
			}

			return await buildMissionRuntimeSnapshot(mission, input.missionId);
		} finally {
			mission.dispose();
		}
	}

	public static async executeAction(
		input: MissionExecuteActionPayload,
		context: { surfacePath: string }
	): Promise<OperatorStatus> {
		const mission = await loadMissionRuntime(input, context, input.terminalSessionName);
		try {
			return operatorStatusSchema.parse(
				await mission.executeAction(
					input.actionId,
					(input.steps ?? []) as OperatorActionExecutionStep[],
					input.terminalSessionName?.trim()
						? { terminalSessionName: input.terminalSessionName.trim() }
						: {}
				)
			) as OperatorStatus;
		} finally {
			mission.dispose();
		}
	}
}

async function loadMissionRuntime(
	input: MissionIdentityPayload,
	context: { surfacePath: string },
	terminalSessionName?: string
): Promise<MissionRuntime> {
	const controlRoot = input.repositoryRootPath?.trim() || context.surfacePath;
	const settings = readRepositorySettingsDocument(controlRoot) ?? createDefaultRepositorySettings();
	const workflow = normalizeWorkflowSettings(
		readMissionWorkflowDefinition(controlRoot) ?? createDefaultWorkflowSettings()
	);
	const taskRunners = new Map(
		(await createConfiguredAgentRunners({
			controlRoot,
			...(terminalSessionName?.trim() ? { terminalSessionName: terminalSessionName.trim() } : {})
		})).map((runner) => [runner.id, runner] as const)
	);
	const mission = await Factory.load(new FilesystemAdapter(controlRoot), { missionId: input.missionId }, {
		workflow,
		resolveWorkflow: () => workflow,
		taskRunners,
		...(settings.instructionsPath
			? { instructionsPath: resolveRepositoryPath(controlRoot, settings.instructionsPath) }
			: {}),
		...(settings.skillsPath ? { skillsPath: resolveRepositoryPath(controlRoot, settings.skillsPath) } : {}),
		...(settings.defaultModel ? { defaultModel: settings.defaultModel } : {}),
		...(settings.defaultAgentMode ? { defaultMode: settings.defaultAgentMode } : {})
	});
	if (!mission) {
		throw new Error(`Mission '${input.missionId}' could not be resolved.`);
	}

	return mission;
}

async function buildMissionRuntimeSnapshot(mission: MissionRuntime, missionId: string) {
	const entity = await mission.toEntity();
	return missionRuntimeSnapshotSchema.parse({
		missionId,
		status: toMissionStatusSummary(entity, missionId),
		sessions: entity.agentSessions.map((session) => agentSessionSchema.parse(session))
	});
}

function toMissionStatusSummary(mission: MissionEntity, missionId: string) {
	return missionStatusSummarySchema.parse({
		missionId: mission.missionId.trim() || missionId,
		...(mission.title ? { title: mission.title } : {}),
		...(mission.issueId !== undefined ? { issueId: mission.issueId } : {}),
		...(mission.type ? { type: mission.type } : {}),
		...(mission.operationalMode ? { operationalMode: mission.operationalMode } : {}),
		...(mission.branchRef ? { branchRef: mission.branchRef } : {}),
		...(mission.missionDir ? { missionDir: mission.missionDir } : {}),
		...(mission.missionRootDir ? { missionRootDir: mission.missionRootDir } : {}),
		...(mission.artifacts.length > 0 ? { artifacts: structuredClone(mission.artifacts) } : {}),
		...(mission.lifecycle || mission.updatedAt || mission.currentStageId || mission.stages.length > 0
			? {
				workflow: {
					...(mission.lifecycle ? { lifecycle: mission.lifecycle } : {}),
					...(mission.updatedAt ? { updatedAt: mission.updatedAt } : {}),
					...(mission.currentStageId ? { currentStageId: mission.currentStageId } : {}),
					...(mission.stages.length > 0
						? { stages: mission.stages.map((stage) => structuredClone(stage)) }
						: {})
				}
			}
			: {}),
		...(mission.recommendedAction ? { recommendedAction: mission.recommendedAction } : {})
	});
}

function resolveRepositoryPath(repositoryRootPath: string, configuredPath: string): string {
	return path.isAbsolute(configuredPath)
		? configuredPath
		: path.join(repositoryRootPath, configuredPath);
}

function normalizeAgentPrompt(input: Extract<MissionSessionCommandPayload['command'], { action: 'prompt' }>['prompt']) {
	return {
		source: input.source,
		text: input.text,
		...(input.title ? { title: input.title } : {}),
		...(input.metadata ? { metadata: input.metadata } : {})
	};
}

function normalizeAgentCommand(input: Extract<MissionSessionCommandPayload['command'], { action: 'command' }>['command']) {
	return {
		type: input.type,
		...(input.reason ? { reason: input.reason } : {}),
		...(input.metadata ? { metadata: input.metadata } : {})
	};
}