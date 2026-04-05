import { FilesystemAdapter } from '../../lib/FilesystemAdapter.js';
import {
	MISSION_STAGE_TEMPLATE_DEFINITIONS,
	renderMissionProductTemplate,
	renderMissionTaskTemplate,
	type MissionStageTemplateDefinition
} from '../../templates/mission/index.js';
import { renderMissionArtifactTitle } from '../../templates/mission/common.js';
import {
	MISSION_STAGES,
	MISSION_TASK_STAGE_DIRECTORIES,
	type MissionDescriptor,
	type MissionStageId
} from '../../types.js';
import { getMissionArtifactDefinition } from '../../workflow/manifest.js';
import { Artifact } from './Artifact.js';
import { Task } from './Task.js';

export class Stage {
	public constructor(
		private readonly descriptor: MissionDescriptor,
		private readonly currentStage: MissionStageId,
		private readonly delivered = false
	) { }

	public get stage(): MissionStageId {
		return this.currentStage;
	}

	public get directoryName(): string {
		return MISSION_TASK_STAGE_DIRECTORIES[this.currentStage];
	}

	public get previousStage(): MissionStageId | undefined {
		const index = MISSION_STAGES.indexOf(this.currentStage);
		return index > 0 ? MISSION_STAGES[index - 1] : undefined;
	}

	public get nextStage(): MissionStageId | undefined {
		if (this.delivered) {
			return undefined;
		}

		const index = MISSION_STAGES.indexOf(this.currentStage);
		if (index < 0 || index >= MISSION_STAGES.length - 1) {
			return undefined;
		}

		return MISSION_STAGES[index + 1];
	}

	public getCurrentStage(): MissionStageId {
		return this.stage;
	}

	public getDirectoryName(): string {
		return this.directoryName;
	}

	public getPreviousStage(): MissionStageId | undefined {
		return this.previousStage;
	}

	public getNextStage(): MissionStageId | undefined {
		return this.nextStage;
	}

	public getAllowedNextStages(): MissionStageId[] {
		const nextStage = this.getNextStage();
		return nextStage ? [nextStage] : [];
	}

	public isAdjacentTransition(targetStage: MissionStageId): boolean {
		const currentIndex = MISSION_STAGES.indexOf(this.currentStage);
		const targetIndex = MISSION_STAGES.indexOf(targetStage);
		return currentIndex >= 0 && targetIndex >= 0 && Math.abs(targetIndex - currentIndex) === 1;
	}

	public async getArtifacts(): Promise<Artifact[]> {
		const timestamp = new Date().toISOString();
		return Promise.all(
			this.getDefinition().artifacts.map(async (template) =>
				new Artifact(this.descriptor.missionDir, {
					kind: 'product',
					key: template.key,
					attributes: {
						title: renderMissionArtifactTitle(template.key, this.descriptor.brief),
						artifact: template.key,
						createdAt: timestamp,
						updatedAt: timestamp,
						...(getMissionArtifactDefinition(template.key).stageId
							? { stage: getMissionArtifactDefinition(template.key).stageId }
							: {})
					},
					body: await renderMissionProductTemplate(template, {
						brief: this.descriptor.brief,
						branchRef: this.descriptor.branchRef
					})
				})
			)
		);
	}

	public async getDefaultTasks(): Promise<Task[]> {
		return Promise.all(
			this.getDefinition().defaultTasks.map(async (templateRef) =>
				new Task(
					this.descriptor.missionDir,
					this.currentStage,
					await renderMissionTaskTemplate(templateRef, {
						brief: this.descriptor.brief,
						branchRef: this.descriptor.branchRef
					})
				)
			)
		);
	}

	public async enter(
		adapter: FilesystemAdapter,
		options: { activateNextTask?: boolean } = {}
	): Promise<void> {
		if (this.getDefinition().defaultTasks.length > 0) {
			await adapter.ensureStageDirectory(this.descriptor.missionDir, this.currentStage);
		}

		for (const artifact of await this.getArtifacts()) {
			await artifact.materialize(adapter);
		}

		for (const task of await this.getDefaultTasks()) {
			await task.materialize(adapter);
		}

		if (options.activateNextTask === true) {
			await this.activateNextTask(adapter);
		}
	}

	public async activateNextTask(adapter: FilesystemAdapter): Promise<void> {
		const tasks = await adapter.listTaskStates(this.descriptor.missionDir, this.currentStage);
		const activeTask = tasks.find((task) => task.status === 'active');
		if (activeTask) {
			return;
		}

		const nextTask = tasks.find((task) => task.status === 'todo' && task.blockedBy.length === 0);
		if (!nextTask) {
			return;
		}

		await Task.fromState(this.descriptor.missionDir, nextTask).activate(adapter);
	}

	private getDefinition(): MissionStageTemplateDefinition {
		return MISSION_STAGE_TEMPLATE_DEFINITIONS[this.currentStage];
	}
}