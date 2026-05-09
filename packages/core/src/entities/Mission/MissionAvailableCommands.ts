import type { AgentExecutionRecord } from '../AgentExecution/AgentExecutionSchema.js';
import type { MissionStageId } from '../../workflow/mission/manifest.js';
import type { MissionWorkflowEvent, MissionStateData } from '../../workflow/engine/index.js';
import { getMissionWorkflowEventValidationErrors } from '../../workflow/engine/validation.js';
import { AgentExecutionCommandIds } from '../AgentExecution/AgentExecutionSchema.js';
import { StageCommandIds } from '../Stage/StageSchema.js';
import { TaskCommandIds } from '../Task/TaskSchema.js';
import { MissionCommandIds, type MissionOwnedCommandDescriptorType } from './MissionSchema.js';
import {
    missionCommand,
    ownedAgentExecutionCommand,
    ownedMissionCommand,
    ownedStageCommand,
    ownedTaskCommand
} from './MissionCommandDescriptors.js';

export type MissionAvailableCommandsInput = {
    missionId: string;
    configuration: MissionStateData['configuration'];
    runtime: MissionStateData['runtime'];
    agentExecutions: AgentExecutionRecord[];
};

export function buildMissionAvailableCommands(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptorType[] {
    const eligibleStageId = resolveEligibleStageId(input);
    const commands: MissionOwnedCommandDescriptorType[] = [
        buildPauseMissionCommand(input),
        buildResumeMissionCommand(input),
        buildRestartLaunchQueueCommand(input),
        buildDeliverMissionCommand(input)
    ];

    if (eligibleStageId) {
        const generationCommand = buildGenerationCommand(input, eligibleStageId);
        if (generationCommand) {
            commands.push(generationCommand);
        }
    }

    for (const task of getOrderedTasks(input)) {
        commands.push(buildTaskStartCommand(input, task));
        commands.push(buildTaskDoneCommand(input, task));
        commands.push(buildTaskReopenCommand(input, task));
        commands.push(buildTaskReworkCommand(input, task));
        commands.push(...buildTaskLaunchPolicyCommands(input, task));
    }

    for (const AgentExecution of getOrderedAgentExecutions(input)) {
        commands.push(buildAgentExecutionCancelCommand(AgentExecution));
    }

    return commands;
}

function buildAvailability(
    enabled: boolean,
    reason?: string
): { disabled: boolean; disabledReason?: string; description?: string } {
    if (enabled) {
        return { disabled: false };
    }
    const disabledReason = reason ?? 'Command is unavailable.';
    return { disabled: true, disabledReason, description: disabledReason };
}

function buildPauseMissionCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptorType {
    const enabled = input.runtime.lifecycle === 'running';
    return ownedMissionCommand(missionCommand({
        commandId: MissionCommandIds.pause,
        label: 'Pause Mission',
        ...buildAvailability(enabled, describePauseUnavailable(input)),
        requiresConfirmation: false
    }));
}

function buildResumeMissionCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptorType {
    const errors = getValidationErrors(input, { type: 'mission.resumed' });
    const enabled = input.runtime.lifecycle === 'paused' && errors.length === 0;
    return ownedMissionCommand(missionCommand({
        commandId: MissionCommandIds.resume,
        label: 'Resume Mission',
        ...buildAvailability(enabled, describeResumeUnavailable(input, errors)),
        requiresConfirmation: false
    }));
}

function buildRestartLaunchQueueCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptorType {
    const errors = getValidationErrors(input, { type: 'mission.launch-queue.restarted' });
    const enabled = errors.length === 0;
    return ownedMissionCommand(missionCommand({
        commandId: MissionCommandIds.restartQueue,
        label: 'Restart Launch Queue',
        ...buildAvailability(enabled, describeRestartLaunchQueueUnavailable(input, errors)),
        requiresConfirmation: true,
        confirmationPrompt: 'Clear stale launch requests and retry queued tasks now?'
    }));
}

function buildDeliverMissionCommand(input: MissionAvailableCommandsInput): MissionOwnedCommandDescriptorType {
    const errors = getValidationErrors(input, { type: 'mission.delivered' });
    const delivered = isRuntimeDelivered(input.runtime);
    return ownedMissionCommand(missionCommand({
        commandId: MissionCommandIds.deliver,
        label: 'Deliver Mission',
        ...buildAvailability(!delivered && errors.length === 0, delivered ? 'Mission already delivered.' : errors[0]),
        requiresConfirmation: true,
        confirmationPrompt: 'Deliver this mission now?'
    }));
}

function buildGenerationCommand(input: MissionAvailableCommandsInput, stageId: MissionStageId): MissionOwnedCommandDescriptorType | undefined {
    const generationRule = input.configuration.workflow.taskGeneration.find((candidate) => candidate.stageId === stageId);
    if (!generationRule || (!generationRule.artifactTasks && generationRule.templateSources.length === 0 && generationRule.tasks.length === 0)) {
        return undefined;
    }
    if (input.runtime.tasks.some((task) => task.stageId === stageId) || resolveEligibleStageId(input) !== stageId) {
        return undefined;
    }
    const displayName = input.configuration.workflow.stages[stageId]?.displayName ?? stageId;
    return ownedStageCommand(stageId, missionCommand({
        commandId: StageCommandIds.generateTasks,
        label: `Generate ${displayName} Tasks`,
        ...buildAvailability(true),
        requiresConfirmation: false
    }));
}

function buildTaskStartCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptorType {
    const errors = getValidationErrors(input, { type: 'task.queued', taskId: task.taskId });
    const enabled = task.lifecycle === 'ready' && errors.length === 0;
    return ownedTaskCommand(task.taskId, missionCommand({
        commandId: TaskCommandIds.start,
        label: 'Start task',
        ...buildAvailability(enabled, describeTaskStartUnavailable(input, task, errors)),
        requiresConfirmation: false
    }));
}

function buildTaskDoneCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptorType {
    const errors = getValidationErrors(input, { type: 'task.completed', taskId: task.taskId });
    return ownedTaskCommand(task.taskId, missionCommand({
        commandId: TaskCommandIds.complete,
        label: 'Mark task done',
        ...buildAvailability(errors.length === 0, errors[0]),
        requiresConfirmation: true,
        confirmationPrompt: 'Mark this task done?'
    }));
}

function buildTaskReopenCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptorType {
    const errors = getValidationErrors(input, { type: 'task.reopened', taskId: task.taskId });
    return ownedTaskCommand(task.taskId, missionCommand({
        commandId: TaskCommandIds.reopen,
        label: 'Reopen task',
        ...buildAvailability(errors.length === 0, errors[0]),
        requiresConfirmation: true,
        confirmationPrompt: 'Reopen this task and invalidate downstream stage progress?'
    }));
}

function buildTaskReworkCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptorType {
    const verificationCommand = buildVerificationDerivedTaskReworkCommand(input, task);
    if (verificationCommand) {
        return verificationCommand;
    }
    const errors = getValidationErrors(input, {
        type: 'task.reworked',
        taskId: task.taskId,
        actor: 'human',
        reasonCode: 'manual.rework',
        summary: 'Manual corrective rework requested.',
        artifactRefs: []
    });
    return ownedTaskCommand(task.taskId, missionCommand({
        commandId: TaskCommandIds.rework,
        label: 'Instruct',
        ...buildAvailability(errors.length === 0, errors[0]),
        requiresConfirmation: true,
        confirmationPrompt: 'Restart this task with corrective guidance?',
        input: {
            kind: 'text',
            label: 'Instruction',
            placeholder: 'Explain what was wrong and how the next attempt should correct it.',
            required: true,
            multiline: true
        }
    }));
}

function buildVerificationDerivedTaskReworkCommand(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptorType | undefined {
    const targetTask = resolveVerificationReworkTargetTask(input.runtime.tasks, task);
    if (!targetTask) {
        return undefined;
    }
    const errors = getValidationErrors(input, {
        type: 'task.reworked',
        taskId: targetTask.taskId,
        actor: 'workflow',
        reasonCode: 'verification.failed',
        summary: `Verification task '${task.title}' requested corrective rework for '${targetTask.title}'.`,
        sourceTaskId: task.taskId,
        artifactRefs: []
    });
    return ownedTaskCommand(task.taskId, missionCommand({
        commandId: TaskCommandIds.reworkFromVerification,
        label: 'Send Back',
        ...buildAvailability(errors.length === 0, errors[0]),
        requiresConfirmation: true,
        confirmationPrompt: `Send '${targetTask.title}' back for fixes using the evidence captured by verification task '${task.title}'?`
    }));
}

function buildTaskLaunchPolicyCommands(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number]): MissionOwnedCommandDescriptorType[] {
    const commands: MissionOwnedCommandDescriptorType[] = [];
    const changeErrors = (autostart: boolean) => getValidationErrors(input, {
        type: 'task.launch-policy.changed',
        taskId: task.taskId,
        autostart
    });
    if (task.runtime.autostart) {
        const errors = changeErrors(false);
        commands.push(ownedTaskCommand(task.taskId, missionCommand({
            commandId: TaskCommandIds.disableAutostart,
            label: 'Disable Autostart',
            ...buildAvailability(errors.length === 0, errors[0]),
            requiresConfirmation: false
        })));
    } else {
        const errors = changeErrors(true);
        commands.push(ownedTaskCommand(task.taskId, missionCommand({
            commandId: TaskCommandIds.enableAutostart,
            label: 'Enable Autostart',
            ...buildAvailability(errors.length === 0, errors[0]),
            requiresConfirmation: false
        })));
    }
    return commands;
}

function buildAgentExecutionCancelCommand(execution: AgentExecutionRecord): MissionOwnedCommandDescriptorType {
    const enabled = isActiveAgentExecution(execution.lifecycleState) || hasSemanticInputRequest(execution);
    return ownedAgentExecutionCommand(execution.agentExecutionId, missionCommand({
        commandId: AgentExecutionCommandIds.cancel,
        label: 'Stop agent',
        ...buildAvailability(enabled, 'AgentExecution is not active.'),
        requiresConfirmation: true,
        confirmationPrompt: 'Stop the running agent execution?'
    }));
}

function resolveVerificationReworkTargetTask(
    tasks: Array<{ taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification' | undefined; pairedTaskId?: string | undefined }>,
    task: { taskId: string; stageId: string; title: string; taskKind?: 'implementation' | 'verification' | undefined; pairedTaskId?: string | undefined }
) {
    if (task.taskKind !== 'verification' || !task.pairedTaskId) {
        return undefined;
    }
    return tasks.find((candidate) => candidate.taskId === task.pairedTaskId && candidate.taskKind === 'implementation');
}

function describePauseUnavailable(input: MissionAvailableCommandsInput): string {
    switch (input.runtime.lifecycle) {
        case 'paused': return 'Mission is already paused.';
        case 'delivered': return 'Mission already delivered.';
        default: return 'Mission is not running.';
    }
}

function describeResumeUnavailable(input: MissionAvailableCommandsInput, errors: string[]): string {
    if (input.runtime.lifecycle !== 'paused') {
        return 'Mission is not paused.';
    }
    return errors[0] ?? 'Mission cannot be resumed.';
}

function describeRestartLaunchQueueUnavailable(input: MissionAvailableCommandsInput, errors: string[]): string {
    if (input.runtime.pause.paused || input.runtime.lifecycle !== 'running') {
        return 'Mission must be running to restart the launch queue.';
    }
    const hasQueuedWork = input.runtime.launchQueue.length > 0
        || input.runtime.tasks.some((task) => task.lifecycle === 'queued');
    if (!hasQueuedWork) {
        return 'There are no queued tasks to restart.';
    }
    return errors[0] ?? 'Launch queue cannot be restarted right now.';
}

function describeTaskStartUnavailable(input: MissionAvailableCommandsInput, task: MissionStateData['runtime']['tasks'][number], errors: string[]): string {
    if (input.runtime.lifecycle === 'paused' || input.runtime.pause.paused) {
        return 'Resume the mission before starting new work.';
    }
    switch (task.lifecycle) {
        case 'pending':
            return task.waitingOnTaskIds.length > 0 ? `Waiting on ${task.waitingOnTaskIds.join(', ')}.` : 'Waiting for an earlier stage to become eligible.';
        case 'queued': return 'Task is already queued.';
        case 'running': return 'Task is already running.';
        case 'completed': return 'Task is already completed.';
        case 'failed':
        case 'cancelled': return 'Reopen the task before starting it again.';
        default: return errors[0] ?? 'Task is not ready to start.';
    }
}

function getOrderedTasks(input: MissionAvailableCommandsInput) {
    return [...input.runtime.tasks].sort((left, right) => {
        const leftStageIndex = input.configuration.workflow.stageOrder.indexOf(left.stageId);
        const rightStageIndex = input.configuration.workflow.stageOrder.indexOf(right.stageId);
        if (leftStageIndex !== rightStageIndex) {
            return leftStageIndex - rightStageIndex;
        }
        return left.taskId.localeCompare(right.taskId);
    });
}

function getOrderedAgentExecutions(input: MissionAvailableCommandsInput) {
    return [...input.agentExecutions].sort((left, right) => left.agentExecutionId.localeCompare(right.agentExecutionId));
}

function resolveEligibleStageId(input: MissionAvailableCommandsInput): MissionStageId | undefined {
    for (const stageId of input.configuration.workflow.stageOrder) {
        const stageTasks = input.runtime.tasks.filter((task) => task.stageId === stageId);
        const completed = stageTasks.length > 0 && stageTasks.every((task) => task.lifecycle === 'completed');
        if (!completed) {
            return stageId as MissionStageId;
        }
    }
    return input.configuration.workflow.stageOrder[input.configuration.workflow.stageOrder.length - 1] as MissionStageId | undefined;
}

function isRuntimeDelivered(runtime: MissionStateData['runtime']): boolean {
    return runtime.stages.some((stage) => stage.stageId === 'delivery' && stage.lifecycle === 'completed');
}

function isActiveAgentExecution(lifecycleState: AgentExecutionRecord['lifecycleState']): boolean {
    return lifecycleState === 'starting' || lifecycleState === 'running';
}

function hasSemanticInputRequest(agentExecution: Pick<AgentExecutionRecord, 'lifecycleState' | 'currentInputRequestId'>): boolean {
    return agentExecution.currentInputRequestId !== undefined && agentExecution.currentInputRequestId !== null;
}

function getValidationErrors(
    input: MissionAvailableCommandsInput,
    event:
        | { type: 'mission.resumed' }
        | { type: 'mission.launch-queue.restarted' }
        | { type: 'mission.delivered' }
        | { type: 'task.queued'; taskId: string }
        | { type: 'task.completed'; taskId: string }
        | { type: 'task.reopened'; taskId: string }
        | { type: 'task.reworked'; taskId: string; actor: 'human' | 'system' | 'workflow'; reasonCode: string; summary: string; sourceTaskId?: string; sourceAgentExecutionId?: string; artifactRefs: Array<{ path: string; title?: string }> }
        | { type: 'task.launch-policy.changed'; taskId: string; autostart: boolean }
): string[] {
    return getMissionWorkflowEventValidationErrors(
        input.runtime,
        { eventId: `${input.missionId}:command`, occurredAt: input.runtime.updatedAt, source: 'human', ...event } as MissionWorkflowEvent,
        input.configuration
    );
}
