/**
 * @file packages/core/src/adapters/CopilotAgentRuntime.ts
 * @description Implements the built-in Copilot runtime provider over the Copilot CLI transport.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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

const PROMPT_RE =
	/\[y\/n\]|\[Y\/n\]|\[y\/N\]|\(y\/n\)|\(Y\/N\)|\[yes\/no\]|\bpress enter\b|\bhit enter\b|continue\?|proceed\?|are you sure\?|allow .+\?|\[always\]|\[1\].*\[2\]|\baccept\b.*\?|\bconfirm\b.*\?|\boverwrite\b.*\?|\bcreate\b.*\?|write to file|run this command|do you want/i;

export type CopilotAgentRuntimeOptions = {
	command?: string;
	additionalArgs?: string[];
	logLine?: (line: string) => void;
	env?: NodeJS.ProcessEnv;
};

type CopilotProcessLaunchMode = 'interactive' | 'prompt';

export class CopilotAgentRuntime implements MissionAgentRuntime {
	public readonly id = 'copilot';
	public readonly displayName = 'Copilot CLI';
	public readonly capabilities: MissionAgentRuntimeCapabilities = {
		persistentSessions: true,
		interactiveInput: true,
		scopedPrompts: true,
		resumableSessions: false,
		toolPermissionRequests: false,
		contextWindowVisibility: false,
		tokenUsageVisibility: false,
		costVisibility: false,
		customInstructions: false,
		telemetry: false,
		interruptible: true
	};

	private readonly command: string;
	private readonly additionalArgs: string[];
	private readonly logLine: ((line: string) => void) | undefined;
	private readonly env: NodeJS.ProcessEnv | undefined;

	public constructor(options: CopilotAgentRuntimeOptions = {}) {
		this.command = options.command?.trim() || 'copilot';
		this.additionalArgs = options.additionalArgs ? [...options.additionalArgs] : [];
		this.logLine = options.logLine;
		this.env = options.env;
	}

	public async isAvailable(): Promise<MissionAgentRuntimeAvailability> {
		return new Promise<MissionAgentRuntimeAvailability>((resolve) => {
			const child = spawn(this.command, ['--version'], {
				env: { ...process.env, ...this.env },
				stdio: 'ignore'
			});

			child.once('error', (error) => {
				resolve({
					available: false,
					detail: `Copilot CLI is unavailable via '${this.command}': ${error.message}`
				});
			});

			child.once('close', (code) => {
				resolve(
					code === 0
						? { available: true }
						: {
								available: false,
								detail: `Copilot CLI exited with code ${String(code ?? 'unknown')} when probed via '${this.command} --version'.`
						  }
				);
			});
		});
	}

	public createSession(): Promise<MissionAgentSession> {
		return Promise.resolve(
			new CopilotAgentSession({
				runtimeId: this.id,
				runtimeLabel: this.displayName,
				command: this.command,
				additionalArgs: this.additionalArgs,
				capabilities: this.capabilities,
				...(this.logLine ? { logLine: this.logLine } : {}),
				...(this.env ? { env: this.env } : {})
			})
		);
	}
}

type CopilotAgentSessionOptions = {
	runtimeId: string;
	runtimeLabel: string;
	command: string;
	additionalArgs: string[];
	capabilities: MissionAgentRuntimeCapabilities;
	logLine?: (line: string) => void;
	env?: NodeJS.ProcessEnv;
};

class CopilotAgentSession implements MissionAgentSession {
	private readonly consoleEventEmitter = new MissionAgentEventEmitter<MissionAgentConsoleEvent>();
	private readonly eventEmitter = new MissionAgentEventEmitter<MissionAgentEvent>();
	private readonly logLine: ((line: string) => void) | undefined;
	private readonly command: string;
	private readonly additionalArgs: string[];
	private readonly env: NodeJS.ProcessEnv | undefined;
	private consoleState: MissionAgentConsoleState;
	private sessionState: MissionAgentSessionState;
	private activeProcess: ChildProcessWithoutNullStreams | undefined;
	private sessionSequence = 0;
	private pendingCancellationReason: string | undefined;

	public readonly runtimeId: string;
	public readonly capabilities: MissionAgentRuntimeCapabilities;
	public readonly sessionId: string;
	public readonly onDidConsoleEvent = this.consoleEventEmitter.event;
	public readonly onDidEvent = this.eventEmitter.event;

	public constructor(options: CopilotAgentSessionOptions) {
		this.runtimeId = options.runtimeId;
		this.capabilities = options.capabilities;
		this.command = options.command;
		this.additionalArgs = [...options.additionalArgs];
		this.logLine = options.logLine;
		this.env = options.env;
		this.sessionId = `copilot-${Date.now().toString(36)}`;
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
		const renderedPrompt = renderMissionAgentPrompt(request);
		const launchMode = this.resolveLaunchMode(request);
		this.updateSessionState(
			{
				workingDirectory: request.workingDirectory,
				...(request.title ? { currentTurnTitle: request.title } : {}),
				...(request.scope ? { scope: request.scope } : {}),
				awaitingPermission: null,
				failureMessage: null
			},
			this.activeProcess && !this.activeProcess.killed ? 'running' : 'starting'
		);

		if (launchMode === 'prompt' || !this.activeProcess || this.activeProcess.killed) {
			await this.startProcess(request, renderedPrompt, launchMode);
			return;
		}

		this.activeProcess.stdin.write(`${renderedPrompt}\n`);
		this.appendConsoleLines(
			[`> Submitted follow-up turn${request.title ? `: ${request.title}` : ''}`],
			'system'
		);
		this.updatePromptState(null, false);
	}

	public sendInput(text: string): Promise<void> {
		if (!this.activeProcess || !this.activeProcess.stdin.writable) {
			return Promise.reject(
				new Error('The mission agent is not currently waiting for operator input.')
			);
		}

		const normalizedText = text.trim();
		this.activeProcess.stdin.write(`${normalizedText}\n`);
		this.appendConsoleLines([`> ${normalizedText}`], 'system');
		this.updatePromptState(null, false);
		this.updateSessionState({ awaitingPermission: null }, 'running');
		return Promise.resolve();
	}

	public cancel(reason = 'cancelled by operator'): Promise<void> {
		this.pendingCancellationReason = reason;
		if (this.activeProcess && !this.activeProcess.killed) {
			this.activeProcess.kill('SIGINT');
			return Promise.resolve();
		}

		this.updatePromptState(null, false);
		this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'cancelled');
		this.eventEmitter.fire({
			type: 'session-cancelled',
			reason,
			state: this.getSessionState()
		});
		return Promise.resolve();
	}

	public terminate(reason = 'terminated by operator'): Promise<void> {
		this.pendingCancellationReason = reason;
		if (this.activeProcess && !this.activeProcess.killed) {
			this.activeProcess.kill('SIGTERM');
			return Promise.resolve();
		}

		this.updatePromptState(null, false);
		this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'cancelled');
		this.eventEmitter.fire({
			type: 'session-cancelled',
			reason,
			state: this.getSessionState()
		});
		return Promise.resolve();
	}

	public dispose(): void {
		if (this.activeProcess && !this.activeProcess.killed) {
			this.pendingCancellationReason = this.pendingCancellationReason ?? 'session disposed';
			this.activeProcess.kill('SIGTERM');
		}
		this.activeProcess = undefined;
		this.consoleEventEmitter.dispose();
		this.eventEmitter.dispose();
	}

	private async startProcess(
		request: MissionAgentTurnRequest,
		renderedPrompt: string,
		launchMode: CopilotProcessLaunchMode
	): Promise<void> {
		this.sessionSequence += 1;
		this.pendingCancellationReason = undefined;
		const args =
			launchMode === 'prompt'
				? [
					...this.additionalArgs,
					'--prompt',
					renderedPrompt,
					'--allow-all-tools',
					'--allow-all-paths',
					'--allow-all-urls',
					'--no-ask-user'
				]
				: [...this.additionalArgs, `--interactive=${renderedPrompt}`];
		const commandText = [this.command, ...args].join(' ');
		this.resetConsoleState(request.title ?? `Mission agent turn ${String(this.sessionSequence)}`, commandText);
		this.updateSessionState(
			{
				workingDirectory: request.workingDirectory,
				...(request.title ? { currentTurnTitle: request.title } : {}),
				...(request.scope ? { scope: request.scope } : {}),
				awaitingPermission: null,
				failureMessage: null
			},
			'starting'
		);

		const child = spawn(this.command, args, {
			cwd: request.workingDirectory,
			env: {
				...process.env,
				CI: '1',
				NO_COLOR: '1',
				TERM: 'dumb',
				...this.env
			},
			stdio: 'pipe'
		});
		this.activeProcess = child;

		let stdoutPartial = '';
		let stderrPartial = '';

		const flushChunk = (chunk: string): { lines: string[]; remainder: string } => {
			const lines = chunk.split(/\r?\n/);
			const remainder = lines.pop() ?? '';
			return {
				lines: lines.map((line) => line.trimEnd()).filter((line) => line.length > 0),
				remainder
			};
		};

		child.stdout.on('data', (buffer: Buffer) => {
			const text = buffer.toString();
			const flushed = flushChunk(`${stdoutPartial}${text}`);
			stdoutPartial = flushed.remainder;
			if (flushed.lines.length > 0) {
				this.appendConsoleLines(flushed.lines, 'stdout');
				this.maybeUpdatePromptOptions(flushed.lines);
				this.maybeUpdateTelemetry(flushed.lines);
			}
		});

		child.stderr.on('data', (buffer: Buffer) => {
			const text = buffer.toString();
			const flushed = flushChunk(`${stderrPartial}${text}`);
			stderrPartial = flushed.remainder;
			if (flushed.lines.length > 0) {
				this.appendConsoleLines(flushed.lines, 'stderr');
				this.maybeUpdatePromptOptions(flushed.lines);
				this.maybeUpdateTelemetry(flushed.lines);
			}
		});

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			child.once('spawn', () => {
				settled = true;
				this.updateSessionState({}, 'running');
				this.eventEmitter.fire({
					type: this.sessionSequence === 1 ? 'session-started' : 'session-resumed',
					state: this.getSessionState()
				});
				resolve();
			});

			child.once('error', (error) => {
				this.finishConsoleState();
				this.updateSessionState({ failureMessage: error.message }, 'failed');
				this.eventEmitter.fire({
					type: 'session-failed',
					errorMessage: error.message,
					state: this.getSessionState()
				});
				if (!settled) {
					reject(error);
					return;
				}
				this.appendConsoleLines([`Copilot CLI session error: ${error.message}`], 'system');
			});

			child.once('close', (code) => {
				if (stdoutPartial.trim().length > 0) {
					this.appendConsoleLines([stdoutPartial.trim()], 'stdout');
					this.maybeUpdateTelemetry([stdoutPartial.trim()]);
				}
				if (stderrPartial.trim().length > 0) {
					this.appendConsoleLines([stderrPartial.trim()], 'stderr');
					this.maybeUpdateTelemetry([stderrPartial.trim()]);
				}
				this.finishConsoleState();
				const cancellationReason = this.pendingCancellationReason;
				this.pendingCancellationReason = undefined;

				if (cancellationReason) {
					this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'cancelled');
					this.eventEmitter.fire({
						type: 'session-cancelled',
						reason: cancellationReason,
						state: this.getSessionState()
					});
					if (!settled) {
						resolve();
					}
					return;
				}

				if ((code ?? 0) === 0) {
					this.updateSessionState({ awaitingPermission: null, failureMessage: null }, 'completed');
					this.eventEmitter.fire({
						type: 'session-completed',
						exitCode: code ?? 0,
						state: this.getSessionState()
					});
					if (!settled) {
						resolve();
					}
					return;
				}

				const errorMessage = `Copilot CLI exited with code ${String(code ?? 'unknown')}.`;
				this.updateSessionState({ failureMessage: errorMessage }, 'failed');
				this.eventEmitter.fire({
					type: 'session-failed',
					errorMessage,
					...(code === null ? {} : { exitCode: code }),
					state: this.getSessionState()
				});
				if (!settled) {
					reject(new Error(errorMessage));
					return;
				}
				this.appendConsoleLines([errorMessage], 'system');
			});
		});
	}

	private resolveLaunchMode(request: MissionAgentTurnRequest): CopilotProcessLaunchMode {
		const operatorIntent = request.operatorIntent?.toLowerCase() ?? '';
		if (
			operatorIntent.includes('autonomously') ||
			operatorIntent.includes('stop when the task is finished')
		) {
			return 'prompt';
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

	private updatePromptState(
		promptOptions: string[] | null,
		awaitingInput: boolean,
		promptText?: string
	): void {
		this.consoleState.promptOptions = promptOptions;
		this.consoleState.awaitingInput = awaitingInput;
		this.consoleEventEmitter.fire({
			type: 'prompt',
			state: this.getConsoleState()
		});

		if (awaitingInput && promptOptions && promptText) {
			const request = this.createPermissionRequest(promptText, promptOptions);
			this.updateSessionState({ awaitingPermission: request, failureMessage: null }, 'awaiting-input');
			this.eventEmitter.fire({
				type: 'permission-requested',
				request,
				state: this.getSessionState()
			});
			return;
		}

		this.updateSessionState(
			{ awaitingPermission: null },
			this.isTerminalState(this.sessionState.lifecycleState)
				? this.sessionState.lifecycleState
				: 'running'
		);
	}

	private maybeUpdatePromptOptions(lines: string[]): void {
		const promptRequest = this.extractPromptRequest(lines);
		if (!promptRequest) {
			return;
		}

		this.updatePromptState(promptRequest.options, true, promptRequest.prompt);
	}

	private maybeUpdateTelemetry(lines: string[]): void {
		let nextTelemetry: MissionAgentTelemetrySnapshot = this.sessionState.telemetry
			? cloneMissionAgentTelemetrySnapshot(this.sessionState.telemetry) ?? {
					updatedAt: new Date().toISOString()
				}
			: {
				updatedAt: new Date().toISOString()
			};
		let changed = false;

		for (const line of lines) {
			const modelMatch = line.match(/\bmodel\s*:\s*(.+)$/i);
			if (modelMatch) {
				const modelId = modelMatch[1]?.trim();
				if (modelId) {
					nextTelemetry = {
						...nextTelemetry,
						model: {
							...(nextTelemetry.model ? nextTelemetry.model : {}),
							id: modelId,
							provider: nextTelemetry.model?.provider ?? 'copilot'
						}
					};
					changed = true;
				}
			}

			const providerSessionMatch = line.match(
				/\b(?:session id|conversation id)\s*:\s*([a-z0-9._:-]+)/i
			);
			if (providerSessionMatch?.[1]) {
				nextTelemetry = {
					...nextTelemetry,
					providerSessionId: providerSessionMatch[1].trim()
				};
				changed = true;
			}

			const inputTokens = this.parseCountMetric(line, /\binput tokens?\s*:\s*([\d,]+)/i);
			if (inputTokens !== undefined) {
				nextTelemetry = {
					...nextTelemetry,
					tokenUsage: {
						...(nextTelemetry.tokenUsage ?? {}),
						inputTokens
					}
				};
				changed = true;
			}

			const outputTokens = this.parseCountMetric(line, /\boutput tokens?\s*:\s*([\d,]+)/i);
			if (outputTokens !== undefined) {
				nextTelemetry = {
					...nextTelemetry,
					tokenUsage: {
						...(nextTelemetry.tokenUsage ?? {}),
						outputTokens
					}
				};
				changed = true;
			}

			const totalTokens = this.parseCountMetric(line, /\btotal tokens?\s*:\s*([\d,]+)/i);
			if (totalTokens !== undefined) {
				nextTelemetry = {
					...nextTelemetry,
					tokenUsage: {
						...(nextTelemetry.tokenUsage ?? {}),
						totalTokens
					}
				};
				changed = true;
			}

			const contextMatch = line.match(
				/\b(?:context window|context)\s*:\s*([\d,]+)\s*\/\s*([\d,]+)/i
			);
			if (contextMatch?.[1] && contextMatch?.[2]) {
				const usedTokens = this.parseMetricValue(contextMatch[1]);
				const maxTokens = this.parseMetricValue(contextMatch[2]);
				if (usedTokens !== undefined && maxTokens !== undefined && maxTokens > 0) {
					nextTelemetry = {
						...nextTelemetry,
						contextWindow: {
							usedTokens,
							maxTokens,
							utilization: usedTokens / maxTokens
						}
					};
					changed = true;
				}
			}

			const costMatch = line.match(
				/\b(?:estimated\s+)?cost(?:\s+usd)?\s*:\s*\$?([0-9]+(?:\.[0-9]+)?)/i
			);
			if (costMatch?.[1]) {
				const estimatedCostUsd = Number(costMatch[1]);
				if (Number.isFinite(estimatedCostUsd)) {
					nextTelemetry = {
						...nextTelemetry,
						estimatedCostUsd
					};
					changed = true;
				}
			}

			const activeToolMatch = line.match(/\b(?:active tool|tool)\s*:\s*(.+)$/i);
			if (activeToolMatch?.[1]) {
				const activeToolName = activeToolMatch[1].trim();
				if (activeToolName.length > 0) {
					nextTelemetry = {
						...nextTelemetry,
						activeToolName
					};
					changed = true;
				}
			}
		}

		if (!changed) {
			return;
		}

		nextTelemetry = {
			...nextTelemetry,
			updatedAt: new Date().toISOString()
		};
		this.updateTelemetryState(nextTelemetry);
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

	private finishConsoleState(): void {
		this.activeProcess = undefined;
		this.updatePromptState(null, false);
	}

	private extractPromptRequest(lines: string[]): { prompt: string; options: string[] } | null {
		const candidate = [...lines].reverse().find((line) => PROMPT_RE.test(line));
		if (!candidate) {
			return null;
		}

		if (/\[y\/n\]|\[Y\/n\]|\[y\/N\]|\(y\/n\)|\(Y\/N\)|\[yes\/no\]/i.test(candidate)) {
			return { prompt: candidate, options: ['y', 'n'] };
		}

		const numberedMatches = [...candidate.matchAll(/\[(\d+)\]/g)]
			.map((match) => match[1])
			.filter((match): match is string => typeof match === 'string');
		if (numberedMatches.length >= 2) {
			return { prompt: candidate, options: numberedMatches };
		}

		if (/press enter|hit enter/i.test(candidate)) {
			return { prompt: candidate, options: [''] };
		}

		if (/always/i.test(candidate)) {
			return { prompt: candidate, options: ['always', 'yes', 'no'] };
		}

		return { prompt: candidate, options: ['yes', 'no'] };
	}

	private createPermissionRequest(prompt: string, options: string[]): MissionAgentPermissionRequest {
		return {
			id: `${this.sessionId}-permission-${Date.now().toString(36)}`,
			kind: 'input',
			prompt,
			options: [...options],
			providerDetails: { source: 'copilot-cli' }
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
					? {
							awaitingPermission: cloneMissionAgentPermissionRequest(
								this.sessionState.awaitingPermission
							)
					  }
					: {}
				: patch.awaitingPermission
					? {
							awaitingPermission: cloneMissionAgentPermissionRequest(patch.awaitingPermission)
					  }
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

	private parseCountMetric(line: string, pattern: RegExp): number | undefined {
		const match = line.match(pattern);
		return match?.[1] ? this.parseMetricValue(match[1]) : undefined;
	}

	private parseMetricValue(raw: string): number | undefined {
		const parsed = Number(raw.replace(/,/g, ''));
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	private isTerminalState(state: MissionAgentLifecycleState): boolean {
		return state === 'completed' || state === 'failed' || state === 'cancelled';
	}
}