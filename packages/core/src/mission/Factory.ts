import { MissionRuntime } from './Mission.js';
import { FilesystemAdapter } from '../lib/FilesystemAdapter.js';
import type { MissionBrief, MissionDescriptor, MissionSelector } from '../types.js';
import type { MissionWorkflowBindings } from './Mission.js';
import { createDefaultWorkflowSettings } from '../workflow/mission/workflow.js';

export class Factory {
	public static async create(
		adapter: FilesystemAdapter,
		input: {
			brief: MissionBrief;
			branchRef: string;
		},
		workflowBindings: MissionWorkflowBindings = createDefaultMissionWorkflowBindings()
	): Promise<MissionRuntime> {
		const existing = await adapter.resolveMission({
			...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
			branchRef: input.branchRef
		});
		if (existing) {
			const mission = MissionRuntime.hydrate(adapter, existing.missionDir, existing.descriptor, workflowBindings);
			await mission.refresh();
			return mission;
		}

		const missionId = adapter.createMissionId(input.brief);
		const missionDir = adapter.getMissionDir(missionId);
		const missionWorktreePath = adapter.getMissionWorktreePath(missionId);
		const createdAt = new Date().toISOString();
		const branchRef = await adapter.materializeMissionWorktree(missionWorktreePath, input.branchRef);
		const descriptor: MissionDescriptor = {
			missionId,
			missionDir,
			brief: input.brief,
			branchRef,
			createdAt
		};

		const mission = MissionRuntime.hydrate(adapter, missionDir, descriptor, workflowBindings);
		return mission.initialize();
	}

	public static async load(
		adapter: FilesystemAdapter,
		selector: MissionSelector = {},
		workflowBindings: MissionWorkflowBindings = createDefaultMissionWorkflowBindings()
	): Promise<MissionRuntime | undefined> {
		const resolved = await adapter.resolveKnownMission(selector);
		if (!resolved) {
			return undefined;
		}

		const mission = MissionRuntime.hydrate(adapter, resolved.missionDir, resolved.descriptor, workflowBindings);
		await mission.refresh();
		return mission;
	}
}

function createDefaultMissionWorkflowBindings(): MissionWorkflowBindings {
	const workflow = disableWorkflowAutostart(createDefaultWorkflowSettings());
	return {
		workflow,
		resolveWorkflow: () => workflow,
		taskRunners: new Map()
	};
}

function disableWorkflowAutostart(workflow: ReturnType<typeof createDefaultWorkflowSettings>) {
	return {
		...workflow,
		stages: Object.fromEntries(
			Object.entries(workflow.stages).map(([stageId, stage]) => [
				stageId,
				{
					...stage,
					taskLaunchPolicy: {
						...stage.taskLaunchPolicy,
						defaultAutostart: false
					}
				}
			])
		)
	};
}