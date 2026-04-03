import { Mission } from './Mission.js';
import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import type { AgentContext } from '../../agents/agentContext.js';
import type { MissionBrief, MissionDescriptor, MissionSelector } from '../../types.js';

export class Factory {
	public static async create(
		adapter: FilesystemAdapter,
		input: {
			brief: MissionBrief;
			branchRef: string;
			agentContext: AgentContext;
		}
	): Promise<Mission> {
		const existing = await adapter.resolveMission({
			...(input.brief.issueId !== undefined ? { issueId: input.brief.issueId } : {}),
			branchRef: input.branchRef
		});
		if (existing) {
			const mission = Mission.hydrate(adapter, existing.missionDir, existing.descriptor);
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

		const mission = Mission.hydrate(adapter, missionDir, descriptor);
		return mission.initialize();
	}

	public static async load(
		adapter: FilesystemAdapter,
		selector: MissionSelector = {}
	): Promise<Mission | undefined> {
		const resolved = await adapter.resolveMission(selector);
		if (!resolved) {
			return undefined;
		}

		const mission = Mission.hydrate(adapter, resolved.missionDir, resolved.descriptor);
		await mission.refresh();
		return mission;
	}
}