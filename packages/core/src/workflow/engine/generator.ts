import {
    renderMissionTaskTemplate,
    type MissionTaskTemplate
} from '../templates/mission/index.js';
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
                    brief: input.descriptor.brief,
                    branchRef: input.descriptor.branchRef
                }
            )
        )
    );

    const tasks = renderedTasks.map((taskTemplate) =>
        toGeneratedTaskPayload(input.stageId, taskTemplate)
    );

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
        dependsOn: taskTemplate.dependsOn ? [...taskTemplate.dependsOn] : [],
        ...(taskTemplate.agent ? { agentRunner: taskTemplate.agent } : {})
    };
}

function stripMarkdownExtension(fileName: string): string {
    return fileName.toLowerCase().endsWith('.md') ? fileName.slice(0, -3) : fileName;
}
