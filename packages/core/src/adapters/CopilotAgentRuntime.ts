/**
 * @file packages/core/src/adapters/CopilotAgentRuntime.ts
 * @description Implements the built-in Copilot runtime provider over the official Copilot SDK.
 */

import { randomUUID } from 'node:crypto';
import {
	CopilotClient,
	type CopilotSession as SdkCopilotSession,
	type PermissionRequest,
	type PermissionRequestResult,
	type ResumeSessionConfig,
	type SessionConfig,
	type SessionEvent
} from '@github/copilot-sdk';
import {
MissionAgentEventEmitter,
cloneMissionAgentConsoleState,
cloneMissionAgentPermissionRequest,
cloneMissionAgentSessionState,
cloneMissionAgentTelemetrySnapshot,
createEmptyMissionAgentConsoleState,
createEmptyMissionAgentSessionState,
renderMissionAgentPrompt,
type MissionAgentConsoleEvent,
type MissionAgentConsoleState,
type MissionAgentEvent,
type MissionAgentLifecycleState,
type MissionAgentPermissionRequest,
type MissionAgentRuntime,
type MissionAgentRuntimeAvailability,
type MissionAgentRuntimeCapabilities,
type MissionAgentScope,
type MissionAgentSession,
type MissionAgentSessionState,
type MissionAgentTelemetrySnapshot,
type MissionAgentTurnRequest
} from '../daemon/MissionAgentRuntime.js';

export type CopilotAgentRuntimeOptions = {
command?: string;
additionalArgs?: string[];
logLine?: (line: string) => void;
env?: NodeJS.ProcessEnv;
defaultModel?: string;
skillDirectories?: string[];
};

type CopilotSessionMode = 'interactive' | 'autonomous';

type MissionUserInputRequest = {
	question: string;
	choices?: string[];
	allowFreeform?: boolean;
};

type MissionUserInputResponse = {
	answer: string;
	wasFreeform: boolean;
};

type PendingOperatorInput =
| {
kind: 'permission';
request: MissionAgentPermissionRequest;
resolve: (result: PermissionRequestResult) => void;
reject: (error: Error) => void;
  }
	| {
			kind: 'user-input';
			request: MissionAgentPermissionRequest;
			choices: string[];
			allowFreeform: boolean;
			resolve: (result: MissionUserInputResponse) => void;
			reject: (error: Error) => void;
	  };

export class CopilotAgentRuntime implements MissionAgentRuntime {
public readonly id = 'copilot';
public readonly displayName = 'Copilot SDK';
public readonly capabilities: MissionAgentRuntimeCapabilities = {
persistentSessions: true,
interactiveInput: true,
scopedPrompts: true,
resumableSessions: true,
toolPermissionRequests: true,
contextWindowVisibility: true,
tokenUsageVisibility: true,
costVisibility: true,
customInstructions: true,
telemetry: true,
interruptible: true
};

private readonly command: string | undefined;
private readonly additionalArgs: string[];
private readonly logLine: ((line: string) => void) | undefined;
private readonly env: NodeJS.ProcessEnv | undefined;
private readonly defaultModel: string | undefined;
private readonly skillDirectories: string[];
private clientPromise: Promise<CopilotClient> | undefined;

public constructor(options: CopilotAgentRuntimeOptions = {}) {
this.command = options.command?.trim() || undefined;
this.additionalArgs = options.additionalArgs ? [...options.additionalArgs] : [];
this.logLine = options.logLine;
this.env = options.env;
this.defaultModel = options.defaultModel?.trim() || undefined;
this.skillDirectories = (options.skillDirectories ?? []).map((value) => value.trim()).filter(Boolean);
}

public async isAvailable(): Promise<MissionAgentRuntimeAvailability> {
try {
const client = await this.getClient();
const status = await client.getStatus();
return {
available: true,
detail: `Copilot SDK connected to CLI protocol ${String(status.protocolVersion)}.`
};
} catch (error) {
this.clientPromise = undefined;
return {
available: false,
detail: error instanceof Error ? error.message : String(error)
};
}
}

public createSession(): Promise<MissionAgentSession> {
return Promise.resolve(
new CopilotAgentSession({
runtimeId: this.id,
runtimeLabel: this.displayName,
sessionId: `copilot-${randomUUID()}`,
capabilities: this.capabilities,
clientProvider: () => this.getClient(),
...(this.defaultModel ? { defaultModel: this.defaultModel } : {}),
...(this.skillDirectories.length > 0 ? { skillDirectories: this.skillDirectories } : {}),
...(this.logLine ? { logLine: this.logLine } : {})
})
);
}

public resumeSession(sessionId: string): Promise<MissionAgentSession> {
return Promise.resolve(
new CopilotAgentSession({
runtimeId: this.id,
runtimeLabel: this.displayName,
sessionId,
capabilities: this.capabilities,
clientProvider: () => this.getClient(),
resumeExisting: true,
...(this.defaultModel ? { defaultModel: this.defaultModel } : {}),
...(this.skillDirectories.length > 0 ? { skillDirectories: this.skillDirectories } : {}),
...(this.logLine ? { logLine: this.logLine } : {})
})
);
}

private getClient(): Promise<CopilotClient> {
if (this.clientPromise) {
return this.clientPromise;
}

this.clientPromise = (async () => {
const client = new CopilotClient({
autoStart: false,
useStdio: true,
...(this.command ? { cliPath: this.command } : {}),
...(this.additionalArgs.length > 0 ? { cliArgs: [...this.additionalArgs] } : {}),
...(this.env ? { env: { ...process.env, ...this.env } } : {})
});
try {
await client.start();
const status = await client.getStatus();
this.logLine?.(`Copilot SDK ready (CLI ${status.version}, protocol ${String(status.protocolVersion)}).`);
return client;
} catch (error) {
this.clientPromise = undefined;
void client.forceStop().catch(() => undefined);
throw error;
}
})();

return this.clientPromise;
}
}

type CopilotAgentSessionOptions = {
runtimeId: string;
runtimeLabel: string;
sessionId: string;
capabilities: MissionAgentRuntimeCapabilities;
clientProvider: () => Promise<CopilotClient>;
defaultModel?: string;
skillDirectories?: string[];
logLine?: (line: string) => void;
resumeExisting?: boolean;
};

class CopilotAgentSession implements MissionAgentSession {
	private readonly consoleEventEmitter = new MissionAgentEventEmitter<MissionAgentConsoleEvent>();
	private readonly eventEmitter = new MissionAgentEventEmitter<MissionAgentEvent>();
	private readonly clientProvider: () => Promise<CopilotClient>;
	private readonly defaultModel: string | undefined;
	private readonly skillDirectories: string[];
	private readonly logLine: ((line: string) => void) | undefined;
	private readonly toolNamesByCallId = new Map<string, string>();
	private consoleState: MissionAgentConsoleState;
private sessionState: MissionAgentSessionState;
private sdkSession: SdkCopilotSession | undefined;
private sessionSequence = 0;
private pendingCancellationReason: string | undefined;
private pendingOperatorInput: PendingOperatorInput | undefined;
private reconnectAsResume: boolean;
private currentMode: CopilotSessionMode = 'interactive';
private appliedSdkMode: 'interactive' | 'autopilot' | undefined;
private disposed = false;

public readonly runtimeId: string;
public readonly capabilities: MissionAgentRuntimeCapabilities;
public readonly sessionId: string;
public readonly onDidConsoleEvent = this.consoleEventEmitter.event;
public readonly onDidEvent = this.eventEmitter.event;

public constructor(options: CopilotAgentSessionOptions) {
this.runtimeId = options.runtimeId;
this.capabilities = options.capabilities;
this.sessionId = options.sessionId;
this.clientProvider = options.clientProvider;
this.defaultModel = options.defaultModel;
this.skillDirectories = options.skillDirectories ? [...options.skillDirectories] : [];
this.logLine = options.logLine;
this.reconnectAsResume = options.resumeExisting === true;
this.consoleState = createEmptyMissionAgentConsoleState({
title: options.runtimeLabel,
runtimeId: options.runtimeId,
runtimeLabel: options.runtimeLabel,
sessionId: this.sessionId
});
this.sessionState = createEmptyMissionAgentSessionState({
runtimeId: options.runtimeId,
runtimeLabel: options.runtimeLabel,
sessionId: this.sessionId
});
}

public getConsoleState(): MissionAgentConsoleState {
return cloneMissionAgentConsoleState(this.consoleState);
}

public getSessionState(): MissionAgentSessionState {
return cloneMissionAgentSessionState(this.sessionState);
}

public async submitTurn(request: MissionAgentTurnRequest): Promise<void> {
if (this.disposed) {
throw new Error('The mission agent session has been disposed.');
}

this.sessionSequence += 1;
this.pendingCancellationReason = undefined;
this.currentMode = this.resolveSessionMode(request);
if (!this.sdkSession) {
this.resetConsoleState(
request.title ?? `Mission agent turn ${String(this.sessionSequence)}`,
`copilot-sdk session ${this.sessionId}`
);
}
this.updateSessionState(
{
workingDirectory: request.workingDirectory,
...(request.title ? { currentTurnTitle: request.title } : {}),
...(request.scope ? { scope: request.scope } : {}),
awaitingPermission: null,
failureMessage: null
},
this.sdkSession ? 'running' : 'starting'
);

try {
const sdkSession = await this.ensureSdkSession(request);
await this.applySdkMode();
await sdkSession.send({
prompt: renderMissionAgentPrompt(request),
mode: 'immediate'
});
this.updatePromptState(null, false);
this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'running');
} catch (error) {
const errorMessage = error instanceof Error ? error.message : String(error);
this.markFailed(errorMessage);
throw error instanceof Error ? error : new Error(errorMessage);
}
}

public async sendInput(text: string): Promise<void> {
if (this.disposed) {
throw new Error('The mission agent session has been disposed.');
}

const pending = this.pendingOperatorInput;
if (pending) {
this.pendingOperatorInput = undefined;
this.updatePromptState(null, false);
this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'running');
if (pending.kind === 'permission') {
pending.resolve(this.parsePermissionResult(text));
return;
}
pending.resolve({
answer: text.trim(),
wasFreeform: !pending.choices.includes(text.trim())
});
return;
}

if (!this.sdkSession) {
throw new Error('The mission agent is not currently waiting for operator input.');
}

const prompt = text.trim();
if (!prompt) {
throw new Error('Operator input cannot be empty.');
}

this.pendingCancellationReason = undefined;
this.updatePromptState(null, false);
this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'running');
await this.sdkSession.send({ prompt, mode: 'immediate' });
}

public async cancel(reason = 'cancelled by operator'): Promise<void> {
this.pendingCancellationReason = reason;
this.resolvePendingOperatorInputOnCancel(reason);
if (this.sdkSession) {
try {
await this.sdkSession.abort();
} catch {
// Ignore abort errors and still tear the session down below.
}
await this.disconnectSdkSession();
}
this.updatePromptState(null, false);
this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'cancelled');
this.eventEmitter.fire({
type: 'session-cancelled',
reason,
state: this.getSessionState()
});
}

public async terminate(reason = 'terminated by operator'): Promise<void> {
this.pendingCancellationReason = reason;
this.resolvePendingOperatorInputOnCancel(reason);
if (this.sdkSession) {
try {
await this.sdkSession.abort();
} catch {
// Ignore abort errors and still disconnect the session.
}
await this.disconnectSdkSession();
}
this.updatePromptState(null, false);
this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'cancelled');
this.eventEmitter.fire({
type: 'session-cancelled',
reason,
state: this.getSessionState()
});
}

public dispose(): void {
this.disposed = true;
this.resolvePendingOperatorInputOnCancel('session disposed');
void this.disconnectSdkSession();
this.consoleEventEmitter.dispose();
this.eventEmitter.dispose();
}

private async ensureSdkSession(request: MissionAgentTurnRequest): Promise<SdkCopilotSession> {
if (this.sdkSession) {
return this.sdkSession;
}

const client = await this.clientProvider();
const session = this.reconnectAsResume
? await client.resumeSession(this.sessionId, this.buildResumeConfig(request))
: await client.createSession(this.buildCreateConfig(request));
this.sdkSession = session;
const lifecycleState = 'running' as const;
this.updateSessionState(
{
workingDirectory: request.workingDirectory,
...(request.title ? { currentTurnTitle: request.title } : {}),
...(request.scope ? { scope: request.scope } : {}),
telemetry: this.buildTelemetryPatch({
providerSessionId: this.sessionId,
model: this.defaultModel
? { id: this.defaultModel, provider: 'copilot-sdk' }
: undefined
})
},
lifecycleState
);
this.eventEmitter.fire({
type: this.reconnectAsResume ? 'session-resumed' : 'session-started',
state: this.getSessionState()
});
this.reconnectAsResume = true;
return session;
}

private buildCreateConfig(request: MissionAgentTurnRequest): SessionConfig {
return {
sessionId: this.sessionId,
clientName: 'mission',
...(this.defaultModel ? { model: this.defaultModel } : {}),
workingDirectory: request.workingDirectory,
streaming: true,
infiniteSessions: { enabled: true },
onPermissionRequest: (permission) => this.handleSdkPermissionRequest(permission),
onUserInputRequest: (input) => this.handleSdkUserInputRequest(input),
onEvent: (event) => {
this.handleSdkEvent(event);
},
...(this.skillDirectories.length > 0 ? { skillDirectories: [...this.skillDirectories] } : {})
};
}

private buildResumeConfig(request: MissionAgentTurnRequest): ResumeSessionConfig {
return {
clientName: 'mission',
...(this.defaultModel ? { model: this.defaultModel } : {}),
workingDirectory: request.workingDirectory,
streaming: true,
infiniteSessions: { enabled: true },
onPermissionRequest: (permission) => this.handleSdkPermissionRequest(permission),
onUserInputRequest: (input) => this.handleSdkUserInputRequest(input),
onEvent: (event) => {
this.handleSdkEvent(event);
},
...(this.skillDirectories.length > 0 ? { skillDirectories: [...this.skillDirectories] } : {})
};
}

private async applySdkMode(): Promise<void> {
if (!this.sdkSession) {
return;
}
const nextMode = this.currentMode === 'autonomous' ? 'autopilot' : 'interactive';
if (this.appliedSdkMode === nextMode) {
return;
}
await this.sdkSession.rpc.mode.set({ mode: nextMode });
this.appliedSdkMode = nextMode;
}

	private async handleSdkPermissionRequest(request: PermissionRequest): Promise<PermissionRequestResult> {
		const permissionRequest = this.createPermissionRequestFromSdkRequest(request);
		return new Promise<PermissionRequestResult>((resolve, reject) => {
			const pending: PendingOperatorInput = {
				kind: 'permission',
request: permissionRequest,
resolve,
reject
};
this.pendingOperatorInput = pending;
this.appendConsoleLines([`Permission requested: ${permissionRequest.prompt}`], 'system');
this.updatePromptState(permissionRequest.options, true, permissionRequest.prompt);
this.updateSessionState({ awaitingPermission: permissionRequest, failureMessage: null }, 'awaiting-input');
this.eventEmitter.fire({
type: 'permission-requested',
request: cloneMissionAgentPermissionRequest(permissionRequest) ?? permissionRequest,
state: this.getSessionState()
});
});
}

	private handleSdkUserInputRequest(request: MissionUserInputRequest): Promise<MissionUserInputResponse> {
		const inputRequest = this.createUserInputRequest(request);
		return new Promise<MissionUserInputResponse>((resolve, reject) => {
this.pendingOperatorInput = {
kind: 'user-input',
request: inputRequest,
choices: request.choices ? [...request.choices] : [],
allowFreeform: request.allowFreeform !== false,
resolve,
reject
};
this.appendConsoleLines([`Input requested: ${inputRequest.prompt}`], 'system');
this.updatePromptState(inputRequest.options, true, inputRequest.prompt);
this.updateSessionState({ awaitingPermission: inputRequest, failureMessage: null }, 'awaiting-input');
this.eventEmitter.fire({
type: 'permission-requested',
request: cloneMissionAgentPermissionRequest(inputRequest) ?? inputRequest,
state: this.getSessionState()
});
});
}

private handleSdkEvent(event: SessionEvent): void {
switch (event.type) {
case 'session.start':
case 'session.resume': {
const context = event.data.context;
this.updateSessionState(
{
...(context?.cwd ? { workingDirectory: context.cwd } : {}),
telemetry: this.buildTelemetryPatch({
providerSessionId: this.sessionId,
model: event.data.selectedModel
? { id: event.data.selectedModel, provider: 'copilot-sdk' }
: undefined
})
},
this.isTerminalState(this.sessionState.lifecycleState) ? this.sessionState.lifecycleState : 'running'
);
return;
}
case 'session.context_changed':
this.updateSessionState(
{ ...(event.data.cwd ? { workingDirectory: event.data.cwd } : {}) },
undefined
);
return;
case 'session.idle':
this.handleSessionIdle(event.data.aborted === true);
return;
case 'session.error':
this.markFailed(event.data.message, event.data.statusCode);
return;
case 'session.warning':
case 'session.info':
this.appendConsoleLines([event.data.message], 'system');
return;
case 'system.notification':
this.appendConsoleLines([event.data.content], 'system');
return;
case 'user.message':
this.appendConsoleLines(this.splitOutput(event.data.content), 'system');
return;
case 'assistant.intent':
this.appendConsoleLines([`Intent: ${event.data.intent}`], 'system');
return;
case 'assistant.message':
this.appendConsoleLines(this.splitOutput(event.data.content), 'stdout');
return;
			case 'tool.execution_start':
				this.toolNamesByCallId.set(event.data.toolCallId, event.data.toolName);
				this.appendConsoleLines([`Tool started: ${event.data.toolName}`], 'system');
				this.updateTelemetryState(
					this.buildTelemetryPatch({ activeToolName: event.data.toolName })
);
this.eventEmitter.fire({
type: 'tool-started',
toolName: event.data.toolName,
state: this.getSessionState()
});
return;
case 'tool.execution_progress':
this.appendConsoleLines([event.data.progressMessage], 'system');
return;
case 'tool.execution_partial_result':
this.appendConsoleLines(this.splitOutput(event.data.partialOutput), 'stdout');
return;
			case 'tool.execution_complete': {
				const toolName = this.resolveToolNameFromCompletion(event);
				this.toolNamesByCallId.delete(event.data.toolCallId);
				const lines = this.extractToolCompletionLines(event);
				if (lines.length > 0) {
					this.appendConsoleLines(lines, event.data.success ? 'stdout' : 'stderr');
}
this.updateTelemetryState(
this.buildTelemetryPatch({ activeToolName: toolName })
);
this.eventEmitter.fire({
type: 'tool-finished',
toolName,
...(lines[0] ? { summary: lines[0] } : {}),
state: this.getSessionState()
});
return;
}
case 'assistant.usage':
this.updateTelemetryState(this.buildTelemetryFromUsageEvent(event));
return;
case 'session.usage_info':
this.updateTelemetryState(this.buildTelemetryFromContextEvent(event));
return;
case 'session.compaction_complete':
if (typeof event.data.postCompactionTokens === 'number' && typeof event.data.tokensRemoved === 'number') {
this.appendConsoleLines(
[
`Session compacted: ${String(event.data.tokensRemoved)} tokens removed, ${String(event.data.postCompactionTokens)} tokens remain.`
],
'system'
);
}
return;
case 'session.shutdown':
this.handleSessionShutdown(event);
return;
default:
return;
}
}

private handleSessionIdle(aborted: boolean): void {
this.updatePromptState(null, false);
if (this.isTerminalState(this.sessionState.lifecycleState)) {
return;
}
if (this.currentMode === 'autonomous') {
this.updateSessionState({ awaitingPermission: null, failureMessage: null }, aborted ? 'cancelled' : 'completed');
			if (aborted) {
				this.eventEmitter.fire({
					type: 'session-cancelled',
					...(this.pendingCancellationReason ? { reason: this.pendingCancellationReason } : {}),
					state: this.getSessionState()
				});
} else {
this.eventEmitter.fire({
type: 'session-completed',
exitCode: 0,
state: this.getSessionState()
});
}
void this.disconnectSdkSession();
return;
}
this.updateSessionState({ awaitingPermission: null, failureMessage: null }, aborted ? 'cancelled' : 'idle');
		if (aborted) {
			this.eventEmitter.fire({
				type: 'session-cancelled',
				...(this.pendingCancellationReason ? { reason: this.pendingCancellationReason } : {}),
				state: this.getSessionState()
			});
		}
}

private handleSessionShutdown(event: Extract<SessionEvent, { type: 'session.shutdown' }>): void {
void this.disconnectSdkSession();
if (this.isTerminalState(this.sessionState.lifecycleState)) {
return;
}
this.updateTelemetryState(this.buildTelemetryFromShutdownEvent(event));
if (event.data.shutdownType === 'routine') {
if (this.currentMode === 'autonomous') {
this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'completed');
this.eventEmitter.fire({
type: 'session-completed',
exitCode: 0,
state: this.getSessionState()
});
}
return;
}
this.markFailed(event.data.errorReason ?? 'Copilot SDK session shut down unexpectedly.');
}

private markFailed(errorMessage: string, exitCode?: number): void {
if (this.isTerminalState(this.sessionState.lifecycleState) && this.sessionState.failureMessage === errorMessage) {
return;
}
this.updatePromptState(null, false);
this.updateSessionState({ awaitingPermission: null, failureMessage: errorMessage }, 'failed');
this.appendConsoleLines([errorMessage], 'stderr');
this.eventEmitter.fire({
type: 'session-failed',
errorMessage,
...(exitCode === undefined ? {} : { exitCode }),
state: this.getSessionState()
});
}

private async disconnectSdkSession(): Promise<void> {
const sdkSession = this.sdkSession;
this.sdkSession = undefined;
this.appliedSdkMode = undefined;
if (!sdkSession) {
return;
}
try {
await sdkSession.disconnect();
} catch (error) {
const message = error instanceof Error ? error.message : String(error);
this.logLine?.(`Copilot SDK disconnect warning: ${message}`);
}
}

private resolvePendingOperatorInputOnCancel(reason: string): void {
const pending = this.pendingOperatorInput;
this.pendingOperatorInput = undefined;
if (!pending) {
return;
}
if (pending.kind === 'permission') {
pending.resolve({ kind: 'denied-interactively-by-user', feedback: reason });
return;
}
pending.reject(new Error(reason));
}

private createPermissionRequestFromSdkRequest(request: PermissionRequest): MissionAgentPermissionRequest {
switch (request.kind) {
case 'shell':
return {
id: `${this.sessionId}-permission-${randomUUID()}`,
kind: 'command',
prompt: `${String(request['intention'] ?? 'Allow command execution?')}\nCommand: ${String(request['fullCommandText'] ?? '')}`.trim(),
options: ['yes', 'no'],
providerDetails: {
source: 'copilot-sdk',
kind: 'shell',
command: String(request['fullCommandText'] ?? '')
}
};
case 'write':
return {
id: `${this.sessionId}-permission-${randomUUID()}`,
kind: 'filesystem',
prompt: `${String(request['intention'] ?? 'Allow file write?')}\nFile: ${String(request['fileName'] ?? '')}`.trim(),
options: ['yes', 'no'],
providerDetails: {
source: 'copilot-sdk',
kind: 'write',
file: String(request['fileName'] ?? '')
}
};
case 'read':
return {
id: `${this.sessionId}-permission-${randomUUID()}`,
kind: 'filesystem',
prompt: `${String(request['intention'] ?? 'Allow file read?')}\nPath: ${String(request['path'] ?? '')}`.trim(),
options: ['yes', 'no'],
providerDetails: {
source: 'copilot-sdk',
kind: 'read',
path: String(request['path'] ?? '')
}
};
case 'mcp':
case 'custom-tool':
				return {
					id: `${this.sessionId}-permission-${randomUUID()}`,
					kind: 'tool',
					prompt: this.describeToolPermissionRequest(request),
					options: ['yes', 'no'],
					providerDetails: {
						source: 'copilot-sdk',
						kind: request.kind,
						tool: String(request['toolName'] ?? request['toolTitle'] ?? '')
					}
				};
case 'url':
return {
id: `${this.sessionId}-permission-${randomUUID()}`,
kind: 'unknown',
prompt: `${String(request['intention'] ?? 'Allow URL access?')}\nURL: ${String(request['url'] ?? '')}`.trim(),
options: ['yes', 'no'],
providerDetails: {
source: 'copilot-sdk',
kind: 'url',
url: String(request['url'] ?? '')
}
};
default:
return {
id: `${this.sessionId}-permission-${randomUUID()}`,
kind: 'unknown',
prompt: `Allow operation of type '${String(request.kind)}'?`,
options: ['yes', 'no'],
providerDetails: { source: 'copilot-sdk', kind: String(request.kind) }
};
}
}

	private createUserInputRequest(request: MissionUserInputRequest): MissionAgentPermissionRequest {
const options = request.choices ? [...request.choices] : [];
return {
id: `${this.sessionId}-input-${randomUUID()}`,
kind: 'input',
prompt: request.question,
options,
providerDetails: {
source: 'copilot-sdk',
allowFreeform: request.allowFreeform !== false,
choiceCount: options.length
}
};
}

	private describeToolPermissionRequest(request: PermissionRequest): string {
		if (request.kind === 'mcp') {
			return `Allow MCP tool '${String(request['toolTitle'] ?? request['toolName'] ?? 'unknown')}' from ${String(request['serverName'] ?? 'unknown server')}?`;
		}
		return `Allow custom tool '${String(request['toolName'] ?? 'unknown')}'?`;
	}

private parsePermissionResult(raw: string): PermissionRequestResult {
const value = raw.trim().toLowerCase();
if (
value === 'y'
|| value === 'yes'
|| value === 'allow'
|| value === 'approve'
|| value === 'approved'
|| value === '1'
|| value === 'always'
|| value === 'true'
) {
return { kind: 'approved' };
}
return {
kind: 'denied-interactively-by-user',
...(value ? { feedback: raw.trim() } : {})
};
}

private resolveSessionMode(request: MissionAgentTurnRequest): CopilotSessionMode {
const operatorIntent = request.operatorIntent?.toLowerCase() ?? '';
if (
operatorIntent.includes('autonomously')
|| operatorIntent.includes('stop when the task is finished')
) {
return 'autonomous';
}
return 'interactive';
}

private resetConsoleState(title: string, commandText: string): void {
this.consoleState = createEmptyMissionAgentConsoleState({
title,
lines: [`$ ${commandText}`],
promptOptions: null,
awaitingInput: false,
runtimeId: this.runtimeId,
...(this.consoleState.runtimeLabel ? { runtimeLabel: this.consoleState.runtimeLabel } : {}),
sessionId: this.sessionId
});
this.logLine?.(`$ ${commandText}`);
this.consoleEventEmitter.fire({
type: 'reset',
state: this.getConsoleState()
});
}

private appendConsoleLines(lines: string[], channel: 'stdout' | 'stderr' | 'system'): void {
if (lines.length === 0) {
return;
}
for (const line of lines) {
this.logLine?.(line);
}
this.consoleState.lines = [...this.consoleState.lines, ...lines].slice(-400);
this.consoleEventEmitter.fire({
type: 'lines',
lines,
state: this.getConsoleState()
});
for (const line of lines) {
this.eventEmitter.fire({
type: 'agent-message',
channel,
text: line,
state: this.getSessionState()
});
}
}

private updatePromptState(promptOptions: string[] | null, awaitingInput: boolean, promptText?: string): void {
this.consoleState.promptOptions = promptOptions;
this.consoleState.awaitingInput = awaitingInput;
this.consoleEventEmitter.fire({
type: 'prompt',
state: this.getConsoleState()
});
if (awaitingInput && promptText) {
return;
}
this.updateSessionState(
{ awaitingPermission: null },
this.isTerminalState(this.sessionState.lifecycleState) ? this.sessionState.lifecycleState : 'running'
);
}

private updateTelemetryState(telemetry: MissionAgentTelemetrySnapshot): void {
this.updateSessionState({ telemetry }, undefined);
const state = this.getSessionState();
const snapshot = cloneMissionAgentTelemetrySnapshot(telemetry);
if (!snapshot) {
return;
}
this.eventEmitter.fire({
type: 'telemetry-updated',
telemetry: snapshot,
state
});
if (snapshot.contextWindow || snapshot.tokenUsage || snapshot.activeToolName || snapshot.model) {
this.eventEmitter.fire({
type: 'context-updated',
telemetry: snapshot,
state
});
}
if (snapshot.estimatedCostUsd !== undefined) {
this.eventEmitter.fire({
type: 'cost-updated',
telemetry: snapshot,
state
});
}
}

	private buildTelemetryFromUsageEvent(
		event: Extract<SessionEvent, { type: 'assistant.usage' }>
	): MissionAgentTelemetrySnapshot {
		const current: MissionAgentTelemetrySnapshot = this.getCurrentTelemetry() ?? {
			updatedAt: new Date().toISOString()
		};
const inputTokens = event.data.inputTokens ?? current.tokenUsage?.inputTokens;
const outputTokens = event.data.outputTokens ?? current.tokenUsage?.outputTokens;
const totalTokens =
(inputTokens ?? 0)
+ (outputTokens ?? 0)
+ (event.data.cacheReadTokens ?? 0)
+ (event.data.cacheWriteTokens ?? 0);
return {
...current,
model: {
...(current.model ?? {}),
id: event.data.model,
provider: current.model?.provider ?? 'copilot-sdk'
},
providerSessionId: current.providerSessionId ?? this.sessionId,
tokenUsage: {
...(current.tokenUsage ?? {}),
...(inputTokens === undefined ? {} : { inputTokens }),
...(outputTokens === undefined ? {} : { outputTokens }),
...(totalTokens > 0 ? { totalTokens } : {})
},
...(typeof event.data.cost === 'number' ? { estimatedCostUsd: event.data.cost } : {}),
updatedAt: new Date().toISOString()
};
}

	private buildTelemetryFromContextEvent(
		event: Extract<SessionEvent, { type: 'session.usage_info' }>
	): MissionAgentTelemetrySnapshot {
		const current: MissionAgentTelemetrySnapshot = this.getCurrentTelemetry() ?? {
			updatedAt: new Date().toISOString()
		};
		return {
			...current,
			providerSessionId: current.providerSessionId ?? this.sessionId,
			contextWindow: {
				usedTokens: event.data.currentTokens,
				maxTokens: event.data.tokenLimit,
				...(event.data.tokenLimit > 0
					? { utilization: event.data.currentTokens / event.data.tokenLimit }
					: {})
			},
			updatedAt: new Date().toISOString()
		};
	}

	private buildTelemetryFromShutdownEvent(
		event: Extract<SessionEvent, { type: 'session.shutdown' }>
	): MissionAgentTelemetrySnapshot {
		const current: MissionAgentTelemetrySnapshot = this.getCurrentTelemetry() ?? {
			updatedAt: new Date().toISOString()
		};
const currentModel = event.data.currentModel;
const currentMetrics =
currentModel && event.data.modelMetrics[currentModel] ? event.data.modelMetrics[currentModel] : undefined;
		return {
			...current,
...(currentModel
? {
model: {
...(current.model ?? {}),
id: currentModel,
provider: current.model?.provider ?? 'copilot-sdk'
}
}
: {}),
providerSessionId: current.providerSessionId ?? this.sessionId,
...(currentMetrics
? {
tokenUsage: {
inputTokens: currentMetrics.usage.inputTokens,
outputTokens: currentMetrics.usage.outputTokens,
totalTokens:
currentMetrics.usage.inputTokens
+ currentMetrics.usage.outputTokens
+ currentMetrics.usage.cacheReadTokens
+ currentMetrics.usage.cacheWriteTokens
}
}
: {}),
			...(event.data.currentTokens !== undefined
				? {
					contextWindow: {
						usedTokens: event.data.currentTokens,
						...(current.contextWindow?.maxTokens !== undefined
							? { maxTokens: current.contextWindow.maxTokens }
							: {}),
						...(current.contextWindow?.maxTokens && current.contextWindow.maxTokens > 0
							? { utilization: event.data.currentTokens / current.contextWindow.maxTokens }
							: current.contextWindow?.utilization !== undefined
								? { utilization: current.contextWindow.utilization }
								: {})
					}
				}
				: {}),
updatedAt: new Date().toISOString()
};
}

	private buildTelemetryPatch(patch: {
		providerSessionId?: string;
		model?: MissionAgentTelemetrySnapshot['model'];
		activeToolName?: string;
	}): MissionAgentTelemetrySnapshot {
		const current: MissionAgentTelemetrySnapshot = this.getCurrentTelemetry() ?? {
			updatedAt: new Date().toISOString()
		};
return {
...current,
...(patch.providerSessionId ? { providerSessionId: patch.providerSessionId } : {}),
...(patch.model ? { model: patch.model } : {}),
...(patch.activeToolName ? { activeToolName: patch.activeToolName } : {}),
updatedAt: new Date().toISOString()
};
}

private updateSessionState(
patch: {
workingDirectory?: string;
currentTurnTitle?: string;
scope?: MissionAgentScope;
awaitingPermission?: MissionAgentPermissionRequest | null;
telemetry?: MissionAgentTelemetrySnapshot | null;
failureMessage?: string | null;
},
lifecycleState?: MissionAgentLifecycleState
): void {
this.sessionState = {
...this.sessionState,
lifecycleState: lifecycleState ?? this.sessionState.lifecycleState,
...(patch.workingDirectory !== undefined
? { workingDirectory: patch.workingDirectory }
: this.sessionState.workingDirectory
? { workingDirectory: this.sessionState.workingDirectory }
: {}),
...(patch.currentTurnTitle !== undefined
? { currentTurnTitle: patch.currentTurnTitle }
: this.sessionState.currentTurnTitle
? { currentTurnTitle: this.sessionState.currentTurnTitle }
: {}),
...(patch.scope !== undefined
? { scope: patch.scope }
: this.sessionState.scope
? { scope: this.sessionState.scope }
: {}),
...(patch.awaitingPermission === undefined
? this.sessionState.awaitingPermission
? { awaitingPermission: cloneMissionAgentPermissionRequest(this.sessionState.awaitingPermission) }
: {}
: patch.awaitingPermission
? { awaitingPermission: cloneMissionAgentPermissionRequest(patch.awaitingPermission) }
: {}),
...(patch.telemetry === undefined
? this.sessionState.telemetry
? { telemetry: cloneMissionAgentTelemetrySnapshot(this.sessionState.telemetry) }
: {}
: patch.telemetry
? { telemetry: cloneMissionAgentTelemetrySnapshot(patch.telemetry) }
: {}),
...(patch.failureMessage === undefined
? this.sessionState.failureMessage
? { failureMessage: this.sessionState.failureMessage }
: {}
: patch.failureMessage
? { failureMessage: patch.failureMessage }
: {}),
lastUpdatedAt: new Date().toISOString()
};
this.eventEmitter.fire({
type: 'session-state-changed',
state: this.getSessionState()
});
}

	private splitOutput(text: string): string[] {
return text
.split(/\r?\n/)
.map((line) => line.trimEnd())
.filter((line) => line.length > 0);
}

	private resolveToolNameFromCompletion(event: Extract<SessionEvent, { type: 'tool.execution_complete' }>): string {
		return this.toolNamesByCallId.get(event.data.toolCallId) ?? event.data.toolCallId;
	}

private extractToolCompletionLines(event: Extract<SessionEvent, { type: 'tool.execution_complete' }>): string[] {
const lines: string[] = [];
if (event.data.result?.detailedContent) {
lines.push(...this.splitOutput(event.data.result.detailedContent));
}
if (lines.length === 0 && event.data.result?.content) {
lines.push(...this.splitOutput(event.data.result.content));
}
for (const content of event.data.result?.contents ?? []) {
if (content.type === 'text' || content.type === 'terminal') {
lines.push(...this.splitOutput(content.text));
}
}
if (lines.length === 0 && event.data.error?.message) {
lines.push(...this.splitOutput(event.data.error.message));
}
return lines;
}

	private isTerminalState(state: MissionAgentLifecycleState): boolean {
		return state === 'completed' || state === 'failed' || state === 'cancelled';
	}

	private getCurrentTelemetry(): MissionAgentTelemetrySnapshot | undefined {
		return this.sessionState.telemetry
			? cloneMissionAgentTelemetrySnapshot(this.sessionState.telemetry)
			: undefined;
	}
}
