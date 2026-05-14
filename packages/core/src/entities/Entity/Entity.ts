import { randomUUID } from 'node:crypto';
import type {
	EntityChannelType,
	EntityCommandDescriptorType,
	EntityEventEnvelopeType,
	EntityIdType,
	EntityMethodType,
	EntityContractType
} from './EntitySchema.js';
import {
	EntityChannelSchema,
	EntityIdSchema,
	EntityTableSchema,
	EntityEventAddressSchema
} from './EntitySchema.js';
import type {
	EntityCommandInvocation,
	EntityFormInvocation,
	EntityQueryInvocation,
	EntityRemoteResult
} from './EntityRemote.js';
import type { MissionRegistry } from '../../daemon/MissionRegistry.js';
import {
	getDefaultEntityFactory,
	type EntityFactory
} from './EntityFactory.js';
import type { AgentExecutionRegistry } from '../../daemon/runtime/agent-execution/AgentExecutionRegistry.js';

export type {
	EntityChannelType,
	EntityEventAddressType,
	EntityIdType
} from './EntitySchema.js';

export type EntityMethodAvailability = {
	available: boolean;
	reason?: string;
};

export type EntityMethodAvailabilityResult = boolean | EntityMethodAvailability | undefined;

export type EntityExecutionContext = {
	surfacePath: string;
	authToken?: string;
	missionRegistry?: MissionRegistry;
	missionService?: unknown;
	entityFactory?: EntityFactory;
	agentExecutionRegistry?: AgentExecutionRegistry;
	codeIntelligenceService?: {
		ensureIndex?(input: { rootPath: string }): Promise<unknown>;
		readActiveIndex?(input: { rootPath: string }): Promise<unknown>;
	};
};

export abstract class Entity<
	TData extends object,
	TId extends string = string,
	TUi extends object = never
> {
	public static readonly entityName: string;

	public static async executeQuery(
		contract: EntityContractType,
		input: EntityQueryInvocation,
		context: EntityExecutionContext
	): Promise<EntityRemoteResult> {
		return Entity.executeMethod('Query', contract, input, context);
	}

	public static async executeCommand(
		contract: EntityContractType,
		input: EntityCommandInvocation | EntityFormInvocation,
		context: EntityExecutionContext
	): Promise<EntityRemoteResult> {
		return Entity.executeMethod('Command', contract, input, context);
	}

	public static async buildUiCommandDescriptors(
		contract: EntityContractType,
		entity: object,
		context: EntityExecutionContext,
		input: {
			execution?: EntityMethodType['execution'];
			payload?: unknown;
		} = {}
	): Promise<EntityCommandDescriptorType[]> {
		const methods = contract.methods ?? {};
		const execution = input.execution ?? 'entity';
		const descriptors = await Promise.all(
			Object.entries(methods)
				.filter(([, method]) => method.ui && method.kind === 'mutation' && method.execution === execution)
				.map(async ([methodName, method]) => {
					const availability = await Entity.resolveMethodAvailability(entity, methodName, execution, input.payload, context);
					return {
						commandId: createEntityMethodCommandId(contract.entity, methodName),
						entity: contract.entity,
						method: methodName,
						...Entity.resolveCommandTarget(entity),
						label: method.ui!.label,
						...(method.ui!.description ? { description: method.ui!.description } : {}),
						available: availability.available,
						...(!availability.available && availability.reason ? { unavailableReason: availability.reason } : {}),
						...(method.ui!.variant ? { variant: method.ui!.variant } : {}),
						...(method.ui!.icon ? { icon: method.ui!.icon } : {}),
						...(method.ui!.tone ? { tone: method.ui!.tone } : {}),
						...(method.ui!.confirmation ? { confirmation: method.ui!.confirmation } : {}),
						...(method.ui!.input ? { input: method.ui!.input } : {}),
						...(method.ui!.presentationOrder !== undefined ? { presentationOrder: method.ui!.presentationOrder } : {})
					} satisfies EntityCommandDescriptorType;
				})
		);

		return descriptors.sort((left, right) =>
			(left.presentationOrder ?? Number.MAX_SAFE_INTEGER) - (right.presentationOrder ?? Number.MAX_SAFE_INTEGER)
			|| left.commandId.localeCompare(right.commandId)
		);
	}

	protected static getEntityFactory(context?: EntityExecutionContext): EntityFactory {
		return context?.entityFactory ?? getDefaultEntityFactory();
	}

	public static async commandDescriptors(
		contract: EntityContractType,
		payload: unknown,
		context: EntityExecutionContext
	): Promise<EntityCommandDescriptorType[]> {
		return Entity.buildUiCommandDescriptors(contract, contract.entityClass, context, {
			execution: 'class',
			payload
		});
	}

	protected getEntityFactory(context?: EntityExecutionContext): EntityFactory {
		return Entity.getEntityFactory(context);
	}

	private static async executeMethod(
		kind: 'Query' | 'Command',
		contract: EntityContractType,
		input: EntityQueryInvocation | EntityCommandInvocation | EntityFormInvocation,
		context: EntityExecutionContext
	): Promise<EntityRemoteResult> {
		const method = Entity.resolveContractMethod(kind, contract, input.method);

		const payload = method.payload.parse(input.payload ?? {});
		const result = await Entity.executeClassMethod(contract, method, input.method, payload, context);

		return method.result.parse(result);
	}

	private static resolveContractMethod(
		kind: 'Query' | 'Command',
		contract: EntityContractType,
		methodName: string
	): EntityMethodType {
		const method = contract.methods?.[methodName];
		if (!method) {
			throw new Error(`${kind} method '${contract.entity}.${methodName}' is not implemented in the daemon.`);
		}

		const expectedKind = kind === 'Query' ? 'query' : 'mutation';
		if (method.kind !== expectedKind) {
			throw new Error(`${kind} method '${contract.entity}.${methodName}' is declared as '${method.kind}'.`);
		}

		return method;
	}

	private static async executeClassMethod(
		contract: EntityContractType,
		method: EntityMethodType,
		methodName: string,
		payload: unknown,
		context: EntityExecutionContext
	): Promise<unknown> {
		const entityClass = contract.entityClass;
		if (!entityClass) {
			throw new Error(`Entity '${contract.entity}' does not define an implementation class for method '${methodName}'.`);
		}

		if (method.execution === 'entity') {
			return Entity.executeEntityInstanceMethod(contract.entity, entityClass, methodName, payload, context);
		}

		return Entity.executeEntityClassMethod(contract.entity, entityClass, methodName, payload, context);
	}

	private static async executeEntityClassMethod(
		entity: string,
		entityClass: EntityContractType['entityClass'],
		methodName: string,
		payload: unknown,
		context: EntityExecutionContext
	): Promise<unknown> {
		const implementation = (entityClass as unknown as Record<string, unknown>)[methodName];
		if (typeof implementation !== 'function') {
			throw new Error(`Entity '${entity}' does not define class method '${methodName}'.`);
		}

		await Entity.assertMethodAvailable(entityClass, methodName, 'class', payload, context);

		return implementation.call(entityClass, payload, context);
	}

	private static async executeEntityInstanceMethod(
		entity: string,
		entityClass: EntityContractType['entityClass'],
		methodName: string,
		payload: unknown,
		context: EntityExecutionContext
	): Promise<unknown> {
		const resolver = (entityClass as { resolve?: (payload: unknown, context?: EntityExecutionContext) => Promise<unknown> | unknown }).resolve;
		if (typeof resolver !== 'function') {
			throw new Error(`Entity '${entity}' does not define resolve() for instance method '${methodName}'.`);
		}

		const instance = await resolver.call(entityClass, payload, context);
		if (!instance || typeof instance !== 'object') {
			throw new Error(`Entity '${entity}' could not be resolved for method '${methodName}'.`);
		}

		const implementation = (instance as Record<string, unknown>)[methodName];
		if (typeof implementation !== 'function') {
			throw new Error(`Entity '${entity}' does not define instance method '${methodName}'.`);
		}

		await Entity.assertMethodAvailable(instance, methodName, 'entity', payload, context);

		return implementation.call(instance, payload, context);
	}

	private static async assertMethodAvailable(
		entity: object,
		methodName: string,
		execution: EntityMethodType['execution'],
		payload: unknown,
		context: EntityExecutionContext
	): Promise<void> {
		const availability = await Entity.resolveMethodAvailability(entity, methodName, execution, payload, context);
		if (!availability.available) {
			throw new Error(availability.reason ?? `Entity method '${methodName}' is not available.`);
		}
	}

	private static async resolveMethodAvailability(
		entity: object,
		methodName: string,
		execution: EntityMethodType['execution'],
		payload: unknown,
		context: EntityExecutionContext
	): Promise<{ available: boolean; reason?: string }> {
		const availabilityMethodName = createEntityAvailabilityMethodName(methodName);
		const availabilityMethod = (entity as Record<string, unknown>)[availabilityMethodName];
		if (availabilityMethod === undefined) {
			return { available: true };
		}
		if (typeof availabilityMethod !== 'function') {
			throw new Error(`Entity availability member '${availabilityMethodName}' is not a method.`);
		}

		const result = execution === 'class'
			? await availabilityMethod.call(entity, payload, context) as EntityMethodAvailabilityResult
			: await availabilityMethod.call(entity, context) as EntityMethodAvailabilityResult;
		if (result === undefined) {
			return { available: true };
		}
		if (typeof result === 'boolean') {
			return { available: result };
		}
		return result.available
			? { available: true }
			: {
				available: false,
				...(result.reason ? { reason: result.reason } : {})
			};
	}

	private static resolveCommandTarget(entity: object): { targetId?: EntityIdType } {
		const candidate = (entity as { id?: unknown }).id;
		if (typeof candidate !== 'string') {
			return {};
		}
		const parsed = EntityIdSchema.safeParse(candidate);
		return parsed.success ? { targetId: parsed.data } : {};
	}

	private dataValue: TData;
	private uiValue: TUi | undefined;

	protected constructor(data: TData) {
		this.dataValue = structuredClone(data);
	}

	public abstract get id(): TId;

	public get entityName(): string {
		const entityName = (this.constructor as typeof Entity).entityName;
		if (!entityName) {
			throw new Error(`Entity class '${this.constructor.name}' does not define static entityName.`);
		}
		return entityName;
	}

	public commandIdFor(methodName: string): string {
		return createEntityMethodCommandId(this.entityName, methodName);
	}

	public availabilityMethodNameFor(methodName: string): string {
		return createEntityAvailabilityMethodName(methodName);
	}

	public async commandDescriptors(
		contract: EntityContractType,
		context: EntityExecutionContext
	): Promise<EntityCommandDescriptorType[]> {
		return Entity.buildUiCommandDescriptors(contract, this, context, { execution: 'entity' });
	}

	protected available(): EntityMethodAvailability {
		return { available: true };
	}

	protected unavailable(reason: string): EntityMethodAvailability {
		return { available: false, reason };
	}

	protected get data(): TData {
		return this.dataValue;
	}

	protected set data(data: TData) {
		this.dataValue = structuredClone(data);
	}

	public updateFromData(data: TData): this {
		this.data = data;
		return this;
	}

	public toData(): TData {
		return structuredClone(this.data);
	}

	protected get ui(): TUi | undefined {
		return this.uiValue
			? structuredClone(this.uiValue)
			: undefined;
	}

	protected set ui(ui: TUi | undefined) {
		this.uiValue = ui
			? structuredClone(ui)
			: undefined;
	}

	public toJSON(): TData {
		return this.toData();
	}

	public async remove(_input: unknown, _context?: EntityExecutionContext): Promise<unknown> {
		throw new Error(`Entity '${this.entityName}' does not implement remove().`);
	}
}

export function createEntityId(table: string, uniqueId: string): EntityIdType {
	const normalizedTable = EntityTableSchema.parse(table);
	const normalizedUniqueId = EntityEventAddressSchema.shape.eventName.parse(uniqueId);
	return EntityIdSchema.parse(`${normalizedTable}:${normalizedUniqueId}`);
}

export function createEntityChannel(entityId: EntityIdType | string, eventName: string): EntityChannelType {
	const normalizedEntityId = EntityIdSchema.parse(entityId);
	const normalizedEventName = EntityEventAddressSchema.shape.eventName.parse(eventName);
	return EntityChannelSchema.parse(`${normalizedEntityId}.${normalizedEventName}`);
}

export function createEntityEventEnvelope(input: {
	entityId: EntityIdType | string;
	eventName: string;
	type?: string;
	missionId?: string;
	payload: unknown;
	occurredAt?: string;
	eventId?: string;
}): EntityEventEnvelopeType {
	const entityId = EntityIdSchema.parse(input.entityId);
	const eventName = EntityEventAddressSchema.shape.eventName.parse(input.eventName);
	const type = EntityEventAddressSchema.shape.eventName.parse(input.type ?? eventName);
	return {
		eventId: input.eventId ?? randomUUID(),
		entityId,
		channel: createEntityChannel(entityId, eventName),
		eventName,
		type,
		occurredAt: input.occurredAt ?? new Date().toISOString(),
		...(input.missionId?.trim() ? { missionId: input.missionId.trim() } : {}),
		payload: input.payload
	};
}

export function getEntityTable(entityId: EntityIdType | string): string {
	const normalizedEntityId = EntityIdSchema.parse(entityId);
	return normalizedEntityId.slice(0, normalizedEntityId.indexOf(':'));
}

export function createEntityMethodCommandId(entityName: string, methodName: string): string {
	const normalizedEntityName = EntityEventAddressSchema.shape.eventName.parse(entityName);
	const normalizedMethodName = EntityEventAddressSchema.shape.eventName.parse(methodName);
	return `${normalizedEntityName.charAt(0).toLowerCase()}${normalizedEntityName.slice(1)}.${normalizedMethodName}`;
}

export function createEntityAvailabilityMethodName(methodName: string): string {
	const normalizedMethodName = EntityEventAddressSchema.shape.eventName.parse(methodName);
	return `can${normalizedMethodName.charAt(0).toUpperCase()}${normalizedMethodName.slice(1)}`;
}

export function matchesEntityChannel(channel: string, pattern: string): boolean {
	const normalizedChannel = EntityChannelSchema.parse(channel);
	const normalizedPattern = EntityEventAddressSchema.shape.eventName.parse(pattern);
	if (normalizedPattern === '*') {
		return true;
	}
	if (!normalizedPattern.includes('*')) {
		return normalizedChannel === normalizedPattern;
	}
	const expression = `^${normalizedPattern.split('*').map(escapeRegExp).join('.*')}$`;
	return new RegExp(expression).test(normalizedChannel);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}