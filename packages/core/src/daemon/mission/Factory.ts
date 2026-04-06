import { Mission } from './Mission.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import type { MissionBrief, MissionDescriptor, MissionSelector } from '../../types.js';
import type { MissionWorkflowBindings } from './Mission.js';
import { createDefaultWorkflowSettings } from '../../workflow/engine/defaultWorkflow.js';

export class Factory {
	public static async create(
		adapter: FilesystemAdapter,
		input: {
			brief: MissionBrief;
			branchRef: string;
		},
		workflowBindings: MissionWorkflowBindings = createDefaultMissionWorkflowBindings()
	): Promise<Mission> {
		const existing = await adapter.resolveMission({
			...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
			branchRef: input.branchRef
		});
		if (existing) {
			const mission = Mission.hydrate(adapter, existing.missionDir, existing.descriptor, workflowBindings);
			await mission.refresh();
			return mission;
		}

		const missionId = adapter.createMissionId(input.brief);
		const missionDir = adapter.getMissionDir(missionId);
		const createdAt = new Date().toISOString();
		const branchRef = await adapter.materializeMissionWorktree(missionDir, input.branchRef);
		const descriptor: MissionDescriptor = {
			missionId,
			missionDir,
			brief: input.brief,
			branchRef,
			createdAt
		};

		const mission = Mission.hydrate(adapter, missionDir, descriptor, workflowBindings);
		return mission.initialize();
	}

	public static async load(
		adapter: FilesystemAdapter,
		selector: MissionSelector = {},
		workflowBindings: MissionWorkflowBindings = createDefaultMissionWorkflowBindings()
	): Promise<Mission | undefined> {
		const resolved = await adapter.resolveMission(selector);
		if (!resolved) {
			return undefined;
		}

		const mission = Mission.hydrate(adapter, resolved.missionDir, resolved.descriptor, workflowBindings);
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
						defaultAutostart: false,
						launchMode: 'manual' as const
					}
				}
			])
		)
	};
}