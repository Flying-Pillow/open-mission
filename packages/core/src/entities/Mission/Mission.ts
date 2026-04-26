import { Entity } from '../Entity.js';
import {
	MISSION_ARTIFACT_KEYS,
	getMissionStageDefinition
} from '../../workflow/mission/manifest.js';
import {
	type MissionLifecycleState,
	type MissionStageId,
	type MissionType,
	type OperatorStatus
} from '../../types.js';
import { toAgentSession, type AgentSession } from '../AgentSession/AgentSession.js';
import {
	createMissionArtifact,
	createTaskArtifact,
	type Artifact
} from '../Artifact/Artifact.js';
import { toTask, type Task } from '../Task/Task.js';
import { createStage, type Stage } from './Stage.js';

export type MissionData = {
	missionId: string;
	title?: string;
	issueId?: number;
	type?: MissionType;
	operationalMode?: string;
	branchRef?: string;
	missionDir?: string;
	missionRootDir?: string;
	lifecycle?: MissionLifecycleState;
	updatedAt?: string;
	currentStageId?: MissionStageId;
	artifacts: Artifact[];
	stages: Stage[];
	agentSessions: AgentSession[];
	recommendedAction?: string;
};

export class Mission extends Entity<MissionData, string> {
	public static read(status: OperatorStatus): Mission {
		const missionId = status.missionId?.trim();
		if (!missionId) {
			throw new Error('Mission entity construction requires an OperatorStatus with missionId.');
		}

		const missionRootDir = status.missionRootDir ?? status.missionDir;
		const productFiles = status.productFiles ?? {};
		const currentStageId = status.workflow?.currentStageId ?? status.stage;
		const artifacts: Artifact[] = [];

		for (const artifactKey of MISSION_ARTIFACT_KEYS) {
			const filePath = productFiles[artifactKey];
			if (!filePath) {
				continue;
			}

			artifacts.push(createMissionArtifact({
				artifactKey,
				filePath,
				...(missionRootDir ? { missionRootDir } : {})
			}));
		}

		const stages: Stage[] = (status.stages ?? []).map((stage) => {
			const stageArtifacts = getMissionStageDefinition(stage.stage).artifacts
				.map((artifactKey) => productFiles[artifactKey]
					? createMissionArtifact({
						artifactKey,
						filePath: productFiles[artifactKey],
						stageId: stage.stage,
						...(missionRootDir ? { missionRootDir } : {})
					})
					: undefined)
				.filter((artifact): artifact is Artifact => artifact !== undefined);
			const tasks: Task[] = stage.tasks.map((task) => {
				const entity = toTask(task);
				if (task.filePath) {
					artifacts.push(createTaskArtifact({
						taskId: task.taskId,
						stageId: task.stage,
						fileName: task.fileName,
						filePath: task.filePath,
						relativePath: task.relativePath
					}));
				}
				return entity;
			});
			return createStage({
				stageId: stage.stage,
				lifecycle: stage.status,
				isCurrentStage: currentStageId === stage.stage,
				artifacts: stageArtifacts,
				tasks
			});
		});

		return new Mission({
			missionId,
			...(status.title ? { title: status.title } : {}),
			...(status.issueId !== undefined ? { issueId: status.issueId } : {}),
			...(status.type ? { type: status.type } : {}),
			...(status.operationalMode ? { operationalMode: status.operationalMode } : {}),
			...(status.branchRef ? { branchRef: status.branchRef } : {}),
			...(status.missionDir ? { missionDir: status.missionDir } : {}),
			...(status.missionRootDir ? { missionRootDir: status.missionRootDir } : {}),
			...(status.workflow?.lifecycle ? { lifecycle: status.workflow.lifecycle } : {}),
			...(status.workflow?.updatedAt ? { updatedAt: status.workflow.updatedAt } : {}),
			...(currentStageId ? { currentStageId } : {}),
			artifacts,
			stages,
			agentSessions: (status.agentSessions ?? []).map((session) => toAgentSession(session)),
			...(status.recommendedAction ? { recommendedAction: status.recommendedAction } : {})
		});
	}

	public constructor(snapshot: MissionData) {
		super({
			...snapshot,
			artifacts: snapshot.artifacts.map((artifact) => structuredClone(artifact)),
			stages: snapshot.stages.map((stage) => structuredClone(stage)),
			agentSessions: snapshot.agentSessions.map((session) => structuredClone(session))
		});
	}

	public get id(): string {
		return this.missionId;
	}

	public get missionId(): string {
		return this.data.missionId;
	}

	public get title(): string | undefined {
		return this.data.title;
	}

	public get issueId(): number | undefined {
		return this.data.issueId;
	}

	public get type(): MissionType | undefined {
		return this.data.type;
	}

	public get operationalMode(): string | undefined {
		return this.data.operationalMode;
	}

	public get branchRef(): string | undefined {
		return this.data.branchRef;
	}

	public get missionDir(): string | undefined {
		return this.data.missionDir;
	}

	public get missionRootDir(): string | undefined {
		return this.data.missionRootDir;
	}

	public get lifecycle(): MissionLifecycleState | undefined {
		return this.data.lifecycle;
	}

	public get updatedAt(): string | undefined {
		return this.data.updatedAt;
	}

	public get currentStageId(): MissionStageId | undefined {
		return this.data.currentStageId;
	}

	public get artifacts(): Artifact[] {
		return this.data.artifacts.map((artifact) => structuredClone(artifact));
	}

	public get stages(): Stage[] {
		return this.data.stages.map((stage) => structuredClone(stage));
	}

	public get agentSessions(): AgentSession[] {
		return this.data.agentSessions.map((session) => structuredClone(session));
	}

	public get recommendedAction(): string | undefined {
		return this.data.recommendedAction;
	}

	public findStage(stageId: MissionStageId): Stage | undefined {
		const stage = this.data.stages.find((candidate) => candidate.stageId === stageId);
		return stage ? structuredClone(stage) : undefined;
	}

	public findArtifact(artifactId: string): Artifact | undefined {
		const artifact = this.data.artifacts.find((candidate) => candidate.artifactId === artifactId);
		return artifact ? structuredClone(artifact) : undefined;
	}

	public findTask(taskId: string): Task | undefined {
		for (const stage of this.data.stages) {
			const task = stage.tasks.find((candidate) => candidate.taskId === taskId);
			if (task) {
				return structuredClone(task);
			}
		}
		return undefined;
	}

	public hasStage(stageId: MissionStageId): boolean {
		return this.data.stages.some((candidate) => candidate.stageId === stageId);
	}

	public isStageCurrent(stageId: MissionStageId): boolean {
		return this.currentStageId === stageId;
	}

	public toSummary(): MissionData {
		return this.toSnapshot();
	}
}

export function toMission(status: OperatorStatus): Mission {
	return Mission.read(status);
}

export type { MissionData as MissionSummary };