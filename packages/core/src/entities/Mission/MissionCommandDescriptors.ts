import type { EntityCommandDescriptorType } from '../Entity/EntitySchema.js';

export const MissionCommandIds = {
	pause: 'mission.pause',
	resume: 'mission.resume',
	panic: 'mission.panic',
	clearPanic: 'mission.clearPanic',
	restartQueue: 'mission.restartQueue',
	deliver: 'mission.deliver'
} as const;

export type MissionCommandOwner =
	| { entity: 'Mission' }
	| { entity: 'Stage'; stageId: string }
	| { entity: 'Task'; taskId: string }
	| { entity: 'AgentSession'; sessionId: string };

export type MissionOwnedCommandDescriptor = {
	owner: MissionCommandOwner;
	command: EntityCommandDescriptorType;
};

export type MissionAvailableCommandSnapshot = {
	commands: MissionOwnedCommandDescriptor[];
	revision: string;
};

export function missionCommand(input: {
	commandId: string;
	label: string;
	disabled: boolean;
	disabledReason?: string;
	description?: string;
	confirmationPrompt?: string;
	requiresConfirmation?: boolean;
	variant?: 'default' | 'destructive';
	input?: EntityCommandDescriptorType['input'];
	presentationOrder?: number;
}): EntityCommandDescriptorType {
	return {
		commandId: input.commandId,
		label: input.label,
		...(input.description ? { description: input.description } : {}),
		disabled: input.disabled,
		...(input.disabledReason ? { disabledReason: input.disabledReason } : {}),
		...(input.variant ? { variant: input.variant } : {}),
		...(input.requiresConfirmation
			? {
				confirmation: {
					required: true,
					...(input.confirmationPrompt ? { prompt: input.confirmationPrompt } : {})
				}
			}
			: {}),
		...(input.input ? { input: input.input } : {}),
		...(input.presentationOrder !== undefined ? { presentationOrder: input.presentationOrder } : {})
	};
}

export function ownedMissionCommand(command: EntityCommandDescriptorType): MissionOwnedCommandDescriptor {
	return { owner: { entity: 'Mission' }, command };
}

export function ownedStageCommand(stageId: string, command: EntityCommandDescriptorType): MissionOwnedCommandDescriptor {
	return { owner: { entity: 'Stage', stageId }, command };
}

export function ownedTaskCommand(taskId: string, command: EntityCommandDescriptorType): MissionOwnedCommandDescriptor {
	return { owner: { entity: 'Task', taskId }, command };
}

export function ownedAgentSessionCommand(sessionId: string, command: EntityCommandDescriptorType): MissionOwnedCommandDescriptor {
	return { owner: { entity: 'AgentSession', sessionId }, command };
}