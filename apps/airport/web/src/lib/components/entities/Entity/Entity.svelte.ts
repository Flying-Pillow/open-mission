import {
	EntityClassCommandViewSchema,
	EntityCommandViewSchema,
	type EntityCommandDescriptorType
} from '@flying-pillow/mission-core/entities/Entity/EntitySchema';
import { cmd } from '../../../../routes/api/entities/remote/command.remote';
import { qry } from '../../../../routes/api/entities/remote/query.remote';

export abstract class Entity<TData, TId extends string = string> {
	protected commandDescriptors = $state<EntityCommandDescriptorType[]>([]);

	public static async classCommands(entityName: string, commandInput?: unknown, input: { run?: boolean } = {}): Promise<EntityCommandDescriptorType[]> {
		const query = qry({
			entity: entityName,
			method: 'classCommands',
			payload: commandInput === undefined ? {} : { commandInput }
		});
		const view = EntityClassCommandViewSchema.parse(input.run === false ? await query : await query.run());
		return structuredClone(view.commands);
	}

	public static async executeClassCommand<TResult = unknown>(
		entityName: string,
		commandId: string,
		input?: unknown
	): Promise<TResult> {
		return await cmd({
			entity: entityName,
			method: Entity.resolveCommandMethodFor(entityName, commandId),
			payload: Entity.buildClassCommandPayload(input)
		}) as TResult;
	}

	public abstract get id(): TId;
	public abstract get entityName(): string;
	public abstract updateFromData(data: TData): this;
	public abstract toData(): TData;
	protected abstract get entityLocator(): Record<string, unknown>;

	public get commands(): EntityCommandDescriptorType[] {
		return structuredClone($state.snapshot(this.commandDescriptors));
	}

	public async loadCommands(): Promise<EntityCommandDescriptorType[]> {
		const view = EntityCommandViewSchema.parse(await qry({
			entity: this.entityName,
			method: 'commands',
			payload: this.entityLocator
		}).run());
		return structuredClone(view.commands);
	}

	public async refreshCommands(): Promise<this> {
		this.commandDescriptors = await this.loadCommands();
		return this;
	}

	public async executeCommand<TResult = unknown>(commandId: string, input?: unknown): Promise<TResult> {
		return await cmd({
			entity: this.entityName,
			method: Entity.resolveCommandMethodFor(this.entityName, commandId),
			payload: this.buildCommandPayload(input)
		}) as TResult;
	}

	protected commandIdFor(methodName: string): string {
		const normalizedEntityName = this.entityName.trim();
		const normalizedMethodName = methodName.trim();
		if (!normalizedEntityName || !normalizedMethodName) {
			throw new Error('Entity command id requires an entity name and method name.');
		}
		return `${normalizedEntityName.charAt(0).toLowerCase()}${normalizedEntityName.slice(1)}.${normalizedMethodName}`;
	}

	private static resolveCommandMethodFor(entityName: string, commandId: string): string {
		const normalizedCommandId = commandId.trim();
		const prefix = `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}.`;
		if (!normalizedCommandId.startsWith(prefix)) {
			throw new Error(`Command '${commandId}' does not belong to Entity '${entityName}'.`);
		}
		const methodName = normalizedCommandId.slice(prefix.length).trim();
		if (!methodName) {
			throw new Error(`Command '${commandId}' does not include an Entity method name.`);
		}
		return methodName;
	}

	private static buildClassCommandPayload(input: unknown): unknown {
		if (input === undefined) {
			return {};
		}
		return structuredClone(input);
	}

	private buildCommandPayload(input: unknown): Record<string, unknown> {
		if (input === undefined) {
			return this.entityLocator;
		}
		if (typeof input !== 'object' || input === null || Array.isArray(input)) {
			return {
				...this.entityLocator,
				input
			};
		}
		return {
			...this.entityLocator,
			...structuredClone(input as Record<string, unknown>)
		};
	}

	public toJSON(): TData {
		return this.toData();
	}
}