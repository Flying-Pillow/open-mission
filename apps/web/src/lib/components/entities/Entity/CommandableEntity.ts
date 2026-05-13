import type { EntityCommandDescriptorType } from '@flying-pillow/open-mission-core/entities/Entity/EntitySchema';

export type CommandableEntity = {
    readonly entityName: string;
    readonly entityId: string;
    readonly commands: EntityCommandDescriptorType[];
    executeCommand(commandId: string, input?: unknown): Promise<unknown>;
};