import type { AgentRunner } from '../agent/AgentRunner.js';
import type { AgentSessionSnapshot } from '../agent/AgentRuntimeTypes.js';
import {
	evaluateMissionTaskStatusIntent,
	type MissionTaskState,
	type MissionTaskStatusIntent
} from '../types.js';
import type { MissionAgentSessionLaunchRequest } from '../daemon/protocol/contracts.js';
import { MissionSession } from './MissionSession.js';

export type MissionTaskLaunchPolicy = {
	autostart: boolean;
};

export type MissionTaskOwner = {
	isMissionDelivered(): boolean;
	refreshTaskState(taskId: string): Promise<MissionTaskState>;
	queueTask(taskId: string, options?: { runnerId?: string; prompt?: string; workingDirectory?: string; terminalSessionName?: string }): Promise<void>;
	completeTask(taskId: string): Promise<void>;
	reopenTask(taskId: string): Promise<void>;
	updateTaskLaunchPolicy(taskId: string, launchPolicy: MissionTaskLaunchPolicy): Promise<void>;
	requireAgentRunner(runnerId: string): AgentRunner;
	startTaskRuntimeSession(
		task: MissionTaskState,
		runner: AgentRunner,
		request: MissionAgentSessionLaunchRequest
	): Promise<AgentSessionSnapshot>;
	recordStartedTaskSession(snapshot: AgentSessionSnapshot): Promise<MissionSession>;
	recordTaskSessionLaunchFailure(taskId: string, error: unknown): Promise<void>;
};

export class MissionTask {
	public constructor(
		private readonly owner: MissionTaskOwner,
		private state: MissionTaskState
	) { }

	public get taskId(): string {
		return this.state.taskId;
	}

	public toState(): MissionTaskState {
		return structuredClone(this.state);
	}

	public async start(options: { runnerId?: string; prompt?: string; workingDirectory?: string; terminalSessionName?: string } = {}): Promise<MissionTaskState> {
		await this.refresh();
		this.assertCanTransition('start');
		if (this.state.status === 'ready') {
			await this.owner.queueTask(this.state.taskId, options);
		}
		await this.refresh();
		return this.toState();
	}

	public async complete(): Promise<MissionTaskState> {
		await this.refresh();
		this.assertCanTransition('done');
		await this.owner.completeTask(this.state.taskId);
		await this.refresh();
		return this.toState();
	}

	public async reopen(): Promise<MissionTaskState> {
		await this.refresh();
		this.assertCanTransition('reopen');
		await this.owner.reopenTask(this.state.taskId);
		await this.refresh();
		return this.toState();
	}

	public async setAutostart(autostart: boolean): Promise<MissionTaskState> {
		await this.owner.updateTaskLaunchPolicy(this.state.taskId, {
			autostart
		});
		await this.refresh();
		return this.toState();
	}

	public async launchSession(
		request: MissionAgentSessionLaunchRequest
	): Promise<MissionSession> {
		await this.prepareForSessionLaunch();
		const runner = this.owner.requireAgentRunner(request.runnerId);
		const availability = await runner.isAvailable();
		if (!availability.available) {
			throw new Error(availability.reason ?? `${runner.displayName} is unavailable.`);
		}

		try {
			const snapshot = await this.owner.startTaskRuntimeSession(this.state, runner, request);
			return this.owner.recordStartedTaskSession(snapshot);
		} catch (error) {
			try {
				await this.owner.recordTaskSessionLaunchFailure(this.state.taskId, error);
			} catch {
				// Preserve the original launch failure when the failure-record side effect cannot be applied.
			}
			throw error;
		}
	}

	private assertCanTransition(intent: MissionTaskStatusIntent): void {
		const evaluation = evaluateMissionTaskStatusIntent(intent, {
			currentStatus: this.state.status,
			waitingOn: this.state.waitingOn,
			delivered: this.owner.isMissionDelivered()
		});
		if (!evaluation.enabled) {
			throw new Error(
				evaluation.reason
					? `Mission task '${this.state.taskId}' cannot transition: ${evaluation.reason}`
					: `Mission task '${this.state.taskId}' cannot transition via '${intent}'.`
			);
		}
	}

	private async prepareForSessionLaunch(): Promise<void> {
		await this.refresh();
		if (this.state.status === 'queued' || this.state.status === 'running') {
			return;
		}

		this.assertCanTransition('start');
	}

	private async refresh(): Promise<void> {
		this.state = await this.owner.refreshTaskState(this.state.taskId);
	}
}