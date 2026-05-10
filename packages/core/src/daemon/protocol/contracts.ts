import type { EntityEventEnvelopeType } from '../../entities/Entity/EntitySchema.js';

export const PROTOCOL_VERSION = 32;

export type Method =
	| 'ping'
	| 'event.subscribe'
	| 'system.status'
	| 'mission-mcp.listTools'
	| 'mission-mcp.callTool'
	| 'entity.query'
	| 'entity.command';

export type MethodWorkspaceRoute = 'none' | 'control' | 'mission';

export type MethodMetadata = {
	includeSurfacePath: boolean;
	workspaceRoute: MethodWorkspaceRoute;
};

export const METHOD_METADATA: Record<Method, MethodMetadata> = {
	'ping': { includeSurfacePath: false, workspaceRoute: 'none' },
	'event.subscribe': { includeSurfacePath: false, workspaceRoute: 'none' },
	'system.status': { includeSurfacePath: true, workspaceRoute: 'none' },
	'mission-mcp.listTools': { includeSurfacePath: false, workspaceRoute: 'none' },
	'mission-mcp.callTool': { includeSurfacePath: false, workspaceRoute: 'none' },
	'entity.query': { includeSurfacePath: true, workspaceRoute: 'control' },
	'entity.command': { includeSurfacePath: true, workspaceRoute: 'control' }
};

export type Notification = EntityEventEnvelopeType;

export type Endpoint = {
	transport: 'ipc';
	path: string;
};

export type Manifest = {
	pid: number;
	startedAt: string;
	protocolVersion: typeof PROTOCOL_VERSION;
	endpoint: Endpoint;
};

export type Ping = {
	ok: true;
	pid: number;
	startedAt: string;
	protocolVersion: typeof PROTOCOL_VERSION;
};

export type Request = {
	type: 'request';
	id: string;
	method: Method;
	surfacePath?: string;
	authToken?: string;
	clientId?: string;
	params?: unknown;
};

export type SuccessResponse = {
	type: 'response';
	id: string;
	ok: true;
	result: unknown;
};

export type ErrorResponse = {
	type: 'response';
	id: string;
	ok: false;
	error: {
		message: string;
		code?: string;
		validationErrors?: unknown[];
	};
};

export type EventMessage = {
	type: 'event';
	event: Notification;
};

export type Response = SuccessResponse | ErrorResponse;

export type Message = Request | Response | EventMessage;

export type EventSubscription = {
	channels?: string[];
};
