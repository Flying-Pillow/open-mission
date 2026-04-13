import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import type { Socket } from 'node:net';
import {
	PROTOCOL_VERSION,
	type AirportClientConnect,
	type AirportClientObserve,
	type AirportPaneBind,
	type ErrorResponse,
	type EventMessage,
	type Manifest,
	type Message,
	type Notification,
	type Ping,
	type Request,
	type Response
} from './protocol/contracts.js';
import {
	getDaemonManifestPath,
	isNamedPipePath,
	resolveDaemonSocketPath
} from './daemonPaths.js';
import { MissionSystemController } from './control-plane/MissionSystemController.js';
import { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { AgentRunner } from '../agent/AgentRunner.js';

export type DaemonOptions = {
	logLine?: (line: string) => void;
	socketPath?: string;
	runners?: AgentRunner[];
};

export class Daemon {
	private readonly server = net.createServer();
	private readonly clients = new Set<Socket>();
	private readonly runners = new Map<string, AgentRunner>();
	private readonly systemController: MissionSystemController;
	private readonly workspaceManager: WorkspaceManager;
	private readonly shutdownPromise: Promise<void>;
	private readonly socketPath: string;
	private readonly logLine: ((line: string) => void) | undefined;
	private resolveShutdown!: () => void;
	private manifest?: Manifest;
	private closed = false;
	private nextClientId = 0;

	public constructor(options: DaemonOptions = {}) {
		this.socketPath = resolveDaemonSocketPath(options.socketPath);
		this.logLine = options.logLine;
		for (const runner of options.runners ?? []) {
			this.runners.set(runner.id, runner);
		}
		this.workspaceManager = new WorkspaceManager(this.runners, (event) => this.broadcastEvent(event));
		this.systemController = new MissionSystemController(this.workspaceManager);
		this.shutdownPromise = new Promise<void>((resolve) => {
			this.resolveShutdown = resolve;
		});
		this.server.on('connection', (socket) => {
			this.handleConnection(socket);
		});
	}

	public getManifest(): Manifest | undefined {
		return this.manifest ? structuredClone(this.manifest) : undefined;
	}

	public async listen(): Promise<Manifest> {
		await this.prepareSocketPath();
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				this.server.off('listening', onListening);
				reject(error);
			};
			const onListening = () => {
				this.server.off('error', onError);
				resolve();
			};

			this.server.once('error', onError);
			this.server.once('listening', onListening);
			this.server.listen(this.socketPath);
		});

		this.manifest = {
			pid: process.pid,
			startedAt: new Date().toISOString(),
			protocolVersion: PROTOCOL_VERSION,
			endpoint: {
				transport: 'ipc',
				path: this.socketPath
			}
		};
		await this.writeManifest();
		this.logLine?.(`Listening on ${this.socketPath} (pid ${String(process.pid)})`);
		return structuredClone(this.manifest);
	}

	public waitUntilClosed(): Promise<void> {
		return this.shutdownPromise;
	}

	public async close(): Promise<void> {
		if (this.closed) {
			await this.shutdownPromise;
			return;
		}

		this.closed = true;
		this.logLine?.('Closing server.');
		for (const client of this.clients) {
			client.end();
			client.destroy();
		}
		this.clients.clear();

		await new Promise<void>((resolve, reject) => {
			if (!this.server.listening) {
				this.resolveShutdown();
				resolve();
				return;
			}

			this.server.close((error) => {
				this.resolveShutdown();
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	}

	private handleConnection(socket: Socket): void {
		const clientId = `client-${String(++this.nextClientId)}`;
		this.clients.add(socket);
		this.logLine?.(`Client connected (${String(this.clients.size)} total).`);
		socket.setEncoding('utf8');
		let buffer = '';

		socket.on('data', (chunk: string) => {
			buffer += chunk;
			while (true) {
				const newlineIndex = buffer.indexOf('\n');
				if (newlineIndex < 0) break;

				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) void this.handleLine(socket, line, clientId);
			}
		});

		socket.on('close', () => {
			this.clients.delete(socket);
			void this.handleClientDisconnected(clientId);
			this.logLine?.(`Client disconnected (${String(this.clients.size)} remaining).`);
		});
		socket.on('error', (error) => {
			this.clients.delete(socket);
			void this.handleClientDisconnected(clientId);
			this.logLine?.(`Client socket error: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	private async handleLine(socket: Socket, line: string, clientId: string): Promise<void> {
		try {
			const message = JSON.parse(line) as Message;
			if (message.type !== 'request') return;
			const request: Request = {
				...message,
				clientId
			};

			this.logLine?.(
				`Incoming ${request.method} request (${request.id})${request.surfacePath ? ` surface=${request.surfacePath}` : ''}`
			);
			const response = await this.handleRequest(request);
			if (this.clients.has(socket)) {
				socket.write(JSON.stringify(response) + '\n');
			}
		} catch (error) {
			this.logLine?.(`Failed to handle message: ${error}`);
		}
	}

	private async handleRequest(request: Request): Promise<Response> {
		try {
			const result = await this.executeMethod(request);
			return { type: 'response', id: request.id, ok: true, result };
		} catch (error) {
			return this.toErrorResponse(request.id, error);
		}
	}

	private async executeMethod(request: Request): Promise<any> {
		if (request.method === 'ping') {
			const pingResult: Ping = {
				ok: true,
				pid: process.pid,
				startedAt: this.manifest?.startedAt ?? new Date().toISOString(),
				protocolVersion: PROTOCOL_VERSION
			};
			return pingResult;
		}

		if (request.method === 'airport.status') {
			await this.systemController.scopeAirportToSurfacePath(request.surfacePath);
			return this.systemController.getSnapshot();
		}
		if (request.method === 'airport.client.connect') {
			return this.executeAirportClientConnect(request);
		}
		if (request.method === 'airport.client.observe') {
			return this.executeAirportClientObserve(request);
		}
		if (request.method === 'airport.pane.bind') {
			return this.executeAirportPaneBind(request);
		}

		const result = await this.workspaceManager.executeMethod(request);
		return this.decorateRequestResultWithSystemState(request, result);
	}

	private broadcastEvent(event: Notification): void {
		void this.decorateEvent(event).then((resolvedEvent) => {
			this.logLine?.(
				`Broadcasting ${resolvedEvent.type}${'missionId' in resolvedEvent ? ` mission=${resolvedEvent.missionId}` : ''}`
			);
			const message: EventMessage = { type: 'event', event: resolvedEvent };
			const wire = JSON.stringify(message) + '\n';
			for (const client of this.clients) {
				client.write(wire, (error) => {
					if (error) {
						this.clients.delete(client);
						client.destroy();
					}
				});
			}
		});
	}

	private async executeAirportClientConnect(request: Request): Promise<any> {
		if (!request.clientId) {
			throw new Error('Airport client registration requires a connected client id.');
		}
		await this.systemController.scopeAirportToSurfacePath(request.surfacePath);
		const params = (request.params ?? {}) as AirportClientConnect;
		if (!params.paneId) {
			throw new Error('Airport client registration requires a pane id.');
		}
		const snapshot = await this.systemController.connectAirportClient({
			clientId: request.clientId,
			...(params.label?.trim() ? { label: params.label.trim() } : {}),
			...(request.surfacePath?.trim() ? { surfacePath: request.surfacePath.trim() } : {}),
			paneId: params.paneId,
			...(params.panelProcessId?.trim() ? { panelProcessId: params.panelProcessId.trim() } : {}),
			...(Number.isInteger(params.terminalPaneId) && (params.terminalPaneId as number) >= 0 ? { terminalPaneId: params.terminalPaneId } : {}),
			...(params.terminalSessionName?.trim() ? { terminalSessionName: params.terminalSessionName.trim() } : {})
		});
		this.broadcastAirportState(snapshot);
		return snapshot;
	}

	private async executeAirportClientObserve(request: Request): Promise<any> {
		if (!request.clientId) {
			throw new Error('Airport client observation requires a connected client id.');
		}
		const params = (request.params ?? {}) as AirportClientObserve;
		const snapshot = await this.systemController.observeAirportClient({
			clientId: request.clientId,
			...(params.focusedPaneId ? { focusedPaneId: params.focusedPaneId } : {}),
			...(params.intentPaneId ? { intentPaneId: params.intentPaneId } : {}),
			...(params.repositoryId?.trim() ? { repositoryId: params.repositoryId.trim() } : {}),
			...(Number.isInteger(params.terminalPaneId) && (params.terminalPaneId as number) >= 0 ? { terminalPaneId: params.terminalPaneId } : {}),
			...(params.terminalSessionName?.trim() ? { terminalSessionName: params.terminalSessionName.trim() } : {}),
			...(request.surfacePath?.trim() ? { surfacePath: request.surfacePath.trim() } : {})
		});
		this.broadcastAirportState(snapshot);
		return snapshot;
	}

	private async executeAirportPaneBind(request: Request): Promise<any> {
		await this.systemController.scopeAirportToSurfacePath(request.surfacePath);
		const params = (request.params ?? {}) as AirportPaneBind;
		this.logLine?.(
			[
				`Airport pane bind`,
				params.paneId ? `pane=${params.paneId}` : undefined,
				params.binding?.targetKind ? `targetKind=${params.binding.targetKind}` : undefined,
				params.binding?.targetId ? `targetId=${params.binding.targetId}` : undefined,
				params.binding?.mode ? `mode=${params.binding.mode}` : undefined,
				request.surfacePath ? `surface=${request.surfacePath}` : undefined
			].filter(Boolean).join(' ')
		);
		const snapshot = await this.systemController.bindAirportPane(params);
		if (params.paneId === 'briefingRoom') {
			this.logLine?.(
				[
					`Resolved Briefing Room projection`,
					snapshot.airportProjections.briefingRoom.artifactPath
						? `artifactPath=${snapshot.airportProjections.briefingRoom.artifactPath}`
						: undefined,
					snapshot.airportProjections.briefingRoom.launchPath
						? `launchPath=${snapshot.airportProjections.briefingRoom.launchPath}`
						: undefined
				].filter(Boolean).join(' ')
			);
		}
		this.broadcastAirportState(snapshot);
		return snapshot;
	}

	private async decorateRequestResultWithSystemState(request: Request, result: unknown): Promise<unknown> {
		if (!result || typeof result !== 'object') {
			return result;
		}

		const workspaceRoot = this.workspaceManager.resolveWorkspaceRootForRequest(request, result);
		if (!workspaceRoot) {
			return result;
		}

		const selectionHint = readSelectionHintFromResult(result);
		const snapshot = await this.systemController.synchronizeWorkspace({
			workspaceRoot,
			...(selectionHint ? { selectionHint } : {})
		});

		if (isOperatorStatus(result)) {
			result.system = snapshot;
			return result;
		}

		if (hasEmbeddedOperatorStatus(result)) {
			result.status.system = snapshot;
		}

		return result;
	}

	private async decorateEvent(event: Notification): Promise<Notification> {
		if (event.type !== 'mission.status') {
			return event;
		}
		const snapshot = await this.systemController.synchronizeWorkspace({
			workspaceRoot: event.workspaceRoot,
			selectionHint: {
				repositoryId: event.workspaceRoot,
				missionId: event.missionId
			}
		});
		return {
			...event,
			status: {
				...event.status,
				system: snapshot
			}
		};
	}

	private async handleClientDisconnected(clientId: string): Promise<void> {
		const snapshot = await this.systemController.disconnectAirportClient(clientId);
		if (snapshot) {
			this.broadcastAirportState(snapshot);
		}
	}

	private broadcastAirportState(snapshot: import('../types.js').MissionSystemSnapshot): void {
		this.logLine?.(
			`Broadcasting airport.state version=${String(snapshot.state.version)}`
		);
		const message: EventMessage = {
			type: 'event',
			event: {
				type: 'airport.state',
				snapshot
			}
		};
		const wire = JSON.stringify(message) + '\n';
		for (const client of this.clients) {
			client.write(wire, (error) => {
				if (error) {
					this.clients.delete(client);
					client.destroy();
				}
			});
		}
	}

	private async writeManifest(): Promise<void> {
		const manifestPath = getDaemonManifestPath();
		await fs.mkdir(path.dirname(manifestPath), { recursive: true });
		await fs.writeFile(manifestPath, JSON.stringify(this.manifest, null, '	') + '\n');
	}

	private async prepareSocketPath(): Promise<void> {
		if (isNamedPipePath(this.socketPath)) {
			return;
		}

		await fs.mkdir(path.dirname(this.socketPath), { recursive: true });
		try {
			await fs.unlink(this.socketPath);
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
				throw error;
			}
		}
	}

	private toErrorResponse(id: string, error: unknown): ErrorResponse {
		const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
		const validationErrors =
			error && typeof error === 'object' && 'validationErrors' in error && Array.isArray(error.validationErrors)
				? error.validationErrors
				: undefined;
		return {
			type: 'response',
			id,
			ok: false,
			error: {
				message: error instanceof Error ? error.message : String(error),
				...(code ? { code } : {}),
				...(validationErrors ? { validationErrors } : {})
			}
		};
	}
}

function isOperatorStatus(value: unknown): value is import('../types.js').OperatorStatus & { system?: import('../types.js').MissionSystemSnapshot } {
	return Boolean(value && typeof value === 'object' && 'found' in value && typeof (value as { found?: unknown }).found === 'boolean');
}

function hasEmbeddedOperatorStatus(value: unknown): value is { status: import('../types.js').OperatorStatus & { system?: import('../types.js').MissionSystemSnapshot } } {
	if (!value || typeof value !== 'object' || !('status' in value)) {
		return false;
	}
	const status = (value as { status?: unknown }).status;
	return isOperatorStatus(status);
}

function readSelectionHintFromResult(value: unknown): Partial<import('../types.js').ContextSelection> | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const missionId = readMissionIdFromResult(value);
	const taskId = readTaskIdFromResult(value);
	const artifactId = readArtifactIdFromResult(value);
	const agentSessionId = readAgentSessionIdFromResult(value);
	if (!missionId && !taskId && !artifactId && !agentSessionId) {
		return undefined;
	}
	return {
		...(missionId ? { missionId } : {}),
		...(taskId ? { taskId } : {}),
		...(artifactId ? { artifactId } : {}),
		...(agentSessionId ? { agentSessionId } : {})
	};
}

function readMissionIdFromResult(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	if ('missionId' in value && typeof value.missionId === 'string' && value.missionId.trim()) {
		return value.missionId;
	}
	if ('status' in value && value.status && typeof value.status === 'object') {
		const status = value.status as { missionId?: string };
		if (typeof status.missionId === 'string' && status.missionId.trim()) {
			return status.missionId;
		}
	}
	return undefined;
}

function readTaskIdFromResult(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	if ('taskId' in value && typeof value.taskId === 'string' && value.taskId.trim()) {
		return value.taskId;
	}
	if ('status' in value && value.status && typeof value.status === 'object') {
		const status = value.status as { taskId?: string };
		if (typeof status.taskId === 'string' && status.taskId.trim()) {
			return status.taskId;
		}
	}
	return undefined;
}

function readArtifactIdFromResult(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	if ('artifactId' in value && typeof value.artifactId === 'string' && value.artifactId.trim()) {
		return value.artifactId;
	}
	if ('status' in value && value.status && typeof value.status === 'object') {
		const status = value.status as { artifactId?: string };
		if (typeof status.artifactId === 'string' && status.artifactId.trim()) {
			return status.artifactId;
		}
	}
	return undefined;
}

function readAgentSessionIdFromResult(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	if ('sessionId' in value && typeof value.sessionId === 'string' && value.sessionId.trim()) {
		return value.sessionId;
	}
	if ('agentSessionId' in value && typeof value.agentSessionId === 'string' && value.agentSessionId.trim()) {
		return value.agentSessionId;
	}
	if ('status' in value && value.status && typeof value.status === 'object') {
		const status = value.status as { sessionId?: string; agentSessionId?: string };
		if (typeof status.sessionId === 'string' && status.sessionId.trim()) {
			return status.sessionId;
		}
		if (typeof status.agentSessionId === 'string' && status.agentSessionId.trim()) {
			return status.agentSessionId;
		}
	}
	return undefined;
}

export async function startDaemon(options: DaemonOptions = {}): Promise<Daemon> {
	const server = new Daemon(options);
	await server.listen();
	return server;
}
