import {
    renderMissionTaskTemplate,
    type MissionTaskTemplate
} from '../mission/templates/index.js';
import { Repository } from '../../entities/Repository/Repository.js';
import type { MissionDescriptor } from '../../types.js';
import type {
    MissionGeneratedTaskPayload,
    MissionStageId,
    MissionWorkflowConfigurationSnapshot,
    WorkflowTaskGenerationRule
} from './types.js';

export interface MissionWorkflowTaskGenerationResult {
    stageId: MissionStageId;
    tasks: MissionGeneratedTaskPayload[];
    rule: WorkflowTaskGenerationRule;
}

export async function generateMissionWorkflowTasks(input: {
    descriptor: MissionDescriptor;
    configuration: MissionWorkflowConfigurationSnapshot;
    stageId: MissionStageId;
}): Promise<MissionWorkflowTaskGenerationResult> {
    const rule = input.configuration.workflow.taskGeneration.find(
        candidate => candidate.stageId === input.stageId
    );
    if (!rule) {
        throw new Error(`Workflow configuration does not define task generation for stage '${input.stageId}'.`);
    }

    const renderedTasks = await Promise.all(
        rule.templateSources.map((templateSource) =>
            renderMissionTaskTemplate(
                { templatePath: templateSource.path },
                {
                    controlRoot: Repository.getMissionControlRootFromMissionDir(input.descriptor.missionDir),
                    brief: input.descriptor.brief,
                    branchRef: input.descriptor.branchRef
                }
            )
        )
    );

    const tasks = normalizeGeneratedTaskDependencies(deduplicateGeneratedTasksByTaskId([
        ...rule.tasks.map((task) => ({
            taskId: task.taskId,
            title: task.title,
            instruction: task.instruction,
            ...(task.taskKind ? { taskKind: task.taskKind } : {}),
            ...(task.pairedTaskId ? { pairedTaskId: task.pairedTaskId } : {}),
            dependsOn: [...task.dependsOn],
            ...(task.agentRunner ? { agentRunner: task.agentRunner } : {})
        })),
        ...renderedTasks.map((taskTemplate) =>
            toGeneratedTaskPayload(input.stageId, taskTemplate)
        )
    ]));

    return {
        stageId: input.stageId,
        tasks,
        rule
    };
}

function toGeneratedTaskPayload(
    stageId: MissionStageId,
    taskTemplate: MissionTaskTemplate
): MissionGeneratedTaskPayload {
    return {
        taskId: `${stageId}/${stripMarkdownExtension(taskTemplate.fileName)}`,
        title: taskTemplate.subject,
        instruction: taskTemplate.instruction,
        ...(taskTemplate.taskKind ? { taskKind: taskTemplate.taskKind } : {}),
        ...(taskTemplate.pairedTaskId ? { pairedTaskId: taskTemplate.pairedTaskId } : {}),
        dependsOn: taskTemplate.dependsOn ? [...taskTemplate.dependsOn] : [],
        ...(taskTemplate.agent ? { agentRunner: taskTemplate.agent } : {})
    };
}

function stripMarkdownExtension(fileName: string): string {
    return fileName.toLowerCase().endsWith('.md') ? fileName.slice(0, -3) : fileName;
}

function deduplicateGeneratedTasksByTaskId(tasks: MissionGeneratedTaskPayload[]): MissionGeneratedTaskPayload[] {
    const seen = new Set<string>();
    const deduplicated: MissionGeneratedTaskPayload[] = [];
    for (const task of tasks) {
        if (seen.has(task.taskId)) {
            continue;
        }
        seen.add(task.taskId);
        deduplicated.push(task);
    }
    return deduplicated;
}

export function normalizeGeneratedTaskDependencies(tasks: MissionGeneratedTaskPayload[]): MissionGeneratedTaskPayload[] {
    const orderedTasks = [...tasks].sort(compareGeneratedTaskOrder);
    const orderedTaskIndexById = new Map(orderedTasks.map((task, index) => [task.taskId, index]));

    return tasks.map((task, index) => ({
        ...task,
        dependsOn: task.dependsOn.length > 0
            ? [...new Set(task.dependsOn.map((dependency) => resolveGeneratedTaskDependencyReference(task, dependency, tasks)))]
            : (orderedTaskIndexById.get(task.taskId) ?? index) > 0
                ? [orderedTasks[(orderedTaskIndexById.get(task.taskId) ?? index) - 1]!.taskId]
                : []
    }));
}

function compareGeneratedTaskOrder(left: MissionGeneratedTaskPayload, right: MissionGeneratedTaskPayload): number {
    const leftTaskId = left.taskId;
    const rightTaskId = right.taskId;
    const leftStem = leftTaskId.split('/').at(-1) ?? leftTaskId;
    const rightStem = rightTaskId.split('/').at(-1) ?? rightTaskId;
    const leftSequence = parseGeneratedTaskSequence(leftStem);
    const rightSequence = parseGeneratedTaskSequence(rightStem);
    if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
    }

    const leftVerificationRank = isVerificationTaskStem(leftStem) ? 1 : 0;
    const rightVerificationRank = isVerificationTaskStem(rightStem) ? 1 : 0;
    if (leftVerificationRank !== rightVerificationRank) {
        return leftVerificationRank - rightVerificationRank;
    }

    return leftTaskId.localeCompare(rightTaskId);
}

function parseGeneratedTaskSequence(taskStem: string): number {
    const match = /^(\d+)/u.exec(taskStem);
    return match ? Number.parseInt(match[1] ?? '', 10) : Number.MAX_SAFE_INTEGER;
}

function isVerificationTaskStem(taskStem: string): boolean {
    return taskStem.endsWith('-verify');
}

function resolveGeneratedTaskDependencyReference(
    task: MissionGeneratedTaskPayload,
    dependency: string,
    tasks: MissionGeneratedTaskPayload[]
): string {
    const trimmedDependency = dependency.trim();
    if (!trimmedDependency) {
        throw new Error(`Task '${task.taskId}' contains an empty dependsOn entry.`);
    }

    const exactMatch = tasks.find((candidate) => candidate.taskId === trimmedDependency);
    if (exactMatch) {
        if (exactMatch.taskId === task.taskId) {
            throw new Error(`Task '${task.taskId}' cannot depend on itself.`);
        }
        return exactMatch.taskId;
    }

    const taskStageId = task.taskId.split('/')[0] ?? '';
    const localMatches = tasks.filter((candidate) => {
        const candidateStageId = candidate.taskId.split('/')[0] ?? '';
        const candidateStem = candidate.taskId.split('/').at(-1) ?? candidate.taskId;
        return candidateStageId === taskStageId && (
            candidateStem === trimmedDependency ||
            `${candidateStem}.md` === trimmedDependency ||
            candidate.taskId === `${taskStageId}/${trimmedDependency}`
        );
    });

    if (localMatches.length > 1) {
        throw new Error(`Task '${task.taskId}' dependsOn '${trimmedDependency}', but that reference is ambiguous.`);
    }
    if (localMatches.length === 1) {
        const dependencyTask = localMatches[0]!;
        if (dependencyTask.taskId === task.taskId) {
            throw new Error(`Task '${task.taskId}' cannot depend on itself.`);
        }
        return dependencyTask.taskId;
    }

    if (trimmedDependency.includes('/')) {
        return trimmedDependency;
    }

    throw new Error(`Task '${task.taskId}' dependsOn '${trimmedDependency}', but no generated task matches that reference.`);
}
