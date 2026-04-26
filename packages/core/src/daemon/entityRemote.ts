import type {
	EntityCommandInvocation,
	EntityFormInvocation,
	EntityQueryInvocation,
	EntityRemoteResult
} from '../airport/entityRemote.js';
import { Repository } from '../entities/Repository/Repository.js';
import {
	repositoryEntityName,
	repositoryRemoteCommandPayloadSchemas,
	repositoryRemoteQueryPayloadSchemas
} from '../entities/Repository/RepositoryRemote.js';

export async function executeEntityQueryInDaemon(
	input: EntityQueryInvocation,
	context: {
		surfacePath: string;
		authToken?: string;
	}
	): Promise<EntityRemoteResult> {
	void context.surfacePath;

	return executeEntityInvocation(input, context, 'query');
}

export async function executeEntityCommandInDaemon(
	input: EntityCommandInvocation | EntityFormInvocation,
	context: {
		surfacePath: string;
		authToken?: string;
	}
	): Promise<EntityRemoteResult> {
	void context.surfacePath;

	return executeEntityInvocation(input, context, 'command');
}

const ENTITY_MODELS = {
	[repositoryEntityName]: {
		cls: Repository,
		queryPayloadSchemas: repositoryRemoteQueryPayloadSchemas,
		commandPayloadSchemas: repositoryRemoteCommandPayloadSchemas,
		resolveInstance: (payload: unknown) => Repository.resolve(payload)
	}
} as const;

async function executeEntityInvocation(
	input: EntityQueryInvocation | EntityCommandInvocation | EntityFormInvocation,
	context: {
		authToken?: string;
	},
	kind: 'query' | 'command'
): Promise<EntityRemoteResult> {
	const entityModel = ENTITY_MODELS[input.entity as keyof typeof ENTITY_MODELS];
	if (!entityModel) {
		throw new Error(`Entity '${input.entity}' is not implemented in the daemon.`);
	}

	const payloadSchema = kind === 'query'
		? entityModel.queryPayloadSchemas[input.method as keyof typeof entityModel.queryPayloadSchemas]
		: entityModel.commandPayloadSchemas[input.method as keyof typeof entityModel.commandPayloadSchemas];
	if (!payloadSchema) {
		throw new Error(`${kind === 'query' ? 'Query' : 'Command'} method '${input.entity}.${input.method}' is not implemented in the daemon.`);
	}

	const payload = payloadSchema.parse(input.payload ?? {});
	const staticMethod = (entityModel.cls as unknown as Record<string, unknown>)[input.method];
	const instanceMethod = (entityModel.cls.prototype as unknown as Record<string, unknown>)[input.method];

	if (typeof instanceMethod === 'function' && typeof staticMethod !== 'function') {
		const instance = await entityModel.resolveInstance(payload);
		if (!instance) {
			throw new Error(`Entity '${input.entity}' could not be resolved for method '${input.method}'.`);
		}
		const callableInstanceMethod = (instance as unknown as Record<string, unknown>)[input.method];
		if (typeof callableInstanceMethod !== 'function') {
			throw new Error(`Instance method '${input.entity}.${input.method}' is not callable in the daemon.`);
		}
		return normalizeEntityRemoteResult(
			await callableInstanceMethod(payload, context)
		);
	}

	if (typeof staticMethod === 'function') {
		const callableStaticMethod = (entityModel.cls as unknown as Record<string, unknown>)[input.method];
		if (typeof callableStaticMethod !== 'function') {
			throw new Error(`Static method '${input.entity}.${input.method}' is not callable in the daemon.`);
		}
		return normalizeEntityRemoteResult(
			await callableStaticMethod(payload, context)
		);
	}

	throw new Error(`Method '${input.entity}.${input.method}' is not callable in the daemon.`);
}

function normalizeEntityRemoteResult(value: unknown): EntityRemoteResult {
	if (value === undefined || value === null) {
		return null;
	}

	if (Array.isArray(value)) {
		return value.map((item) => normalizeEntityRemoteResult(item));
	}

	if (typeof value === 'object' && typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
		return normalizeEntityRemoteResult((value as { toJSON: () => unknown }).toJSON());
	}

	return value;
}