import type { EntityCommandDescriptor } from '@flying-pillow/mission-core/schemas';

export type ActionableEntity = {
    readonly entityName: string;
    readonly entityId: string;
    listCommands(input?: { executionContext?: 'event' | 'render' }): Promise<EntityCommandDescriptor[]>;
    executeCommand(commandId: string, input?: unknown): Promise<void>;
};