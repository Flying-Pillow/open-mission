import type { EntityCommandDescriptorType } from '../Entity/EntitySchema.js';
import type {
	MissionOwnedCommandDescriptorType
} from './MissionSchema.js';

export function missionCommand(input: {
	commandId: string;
	label: string;
	disabled: boolean;
	disabledReason?: string;
	description?: string;
	confirmationPrompt?: string;
	requiresConfirmation?: boolean;
	variant?: EntityCommandDescriptorType['variant'];
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

export function ownedMissionCommand(command: EntityCommandDescriptorType): MissionOwnedCommandDescriptorType {
	return { owner: { entity: 'Mission' }, command };
}

export function ownedStageCommand(stageId: string, command: EntityCommandDescriptorType): MissionOwnedCommandDescriptorType {
	return { owner: { entity: 'Stage', stageId }, command };
}

export function ownedTaskCommand(taskId: string, command: EntityCommandDescriptorType): MissionOwnedCommandDescriptorType {
	return { owner: { entity: 'Task', taskId }, command };
}

export function ownedAgentSessionCommand(sessionId: string, command: EntityCommandDescriptorType): MissionOwnedCommandDescriptorType {
	return { owner: { entity: 'AgentSession', sessionId }, command };
}
