import type { AgentSessionSnapshot } from '../AgentRuntimeTypes.js';
import { AgentSessionObservationRouter } from './AgentSessionObservationRouter.js';
import { AgentSessionSignalPolicy } from './AgentSessionSignalPolicy.js';
import type {
	AgentSessionObservation,
	AgentSessionSignal,
	AgentSessionSignalDecision,
	AgentSessionSignalScope
} from './AgentSessionSignal.js';

type MaybePromise<T> = T | Promise<T>;

export type AgentSessionSignalAcknowledgement = {
	accepted: boolean;
	outcome: 'promoted' | 'recorded' | 'rejected';
	reason?: string;
	sessionStatus?: AgentSessionSnapshot['status'];
	waitingForInput?: boolean;
};

export interface AgentSessionSignalPort {
	reportSignal(input: {
		scope: AgentSessionSignalScope;
		eventId: string;
		signal: AgentSessionSignal;
	}): Promise<AgentSessionSignalAcknowledgement>;
}

export interface AgentSessionSignalPortSink {
	getSnapshot(scope: AgentSessionSignalScope): MaybePromise<AgentSessionSnapshot | undefined>;
	commit(input: {
		snapshot: AgentSessionSnapshot;
		observation: AgentSessionObservation;
		decision: Exclude<AgentSessionSignalDecision, { action: 'reject' }>;
	}): MaybePromise<AgentSessionSnapshot | void>;
}

export class PolicyBoundAgentSessionSignalPort implements AgentSessionSignalPort {
	private readonly sink: AgentSessionSignalPortSink;

	private readonly observationRouter: AgentSessionObservationRouter;

	private readonly signalPolicy: AgentSessionSignalPolicy;

	private readonly now: () => string;

	public constructor(options: {
		sink: AgentSessionSignalPortSink;
		observationRouter?: AgentSessionObservationRouter;
		signalPolicy?: AgentSessionSignalPolicy;
		now?: () => string;
	}) {
		this.sink = options.sink;
		this.observationRouter = options.observationRouter ?? new AgentSessionObservationRouter();
		this.signalPolicy = options.signalPolicy ?? new AgentSessionSignalPolicy();
		this.now = options.now ?? (() => new Date().toISOString());
	}

	public async reportSignal(input: {
		scope: AgentSessionSignalScope;
		eventId: string;
		signal: AgentSessionSignal;
	}): Promise<AgentSessionSignalAcknowledgement> {
		const snapshot = await this.sink.getSnapshot(input.scope);
		if (!snapshot) {
			return {
				accepted: false,
				outcome: 'rejected',
				reason: `Mission session '${input.scope.agentSessionId}' is not active.`
			};
		}

		const observations = this.observationRouter.route({
			kind: 'mcp-signal',
			scope: input.scope,
			observedAt: this.now(),
			dedupeKey: createScopedEventKey(input.scope, input.eventId),
			signal: input.signal
		});
		if (observations.length !== 1) {
			return {
				accepted: false,
				outcome: 'rejected',
				reason: 'Mission MCP tool calls must resolve to exactly one observation.'
			};
		}

		const observation = observations[0]!;
		const decision = this.signalPolicy.evaluate({
			snapshot,
			observation
		});
		if (decision.action === 'reject') {
			return {
				accepted: false,
				outcome: 'rejected',
				reason: decision.reason
			};
		}

		const committedSnapshot = await this.sink.commit({
			snapshot,
			observation,
			decision
		});
		const effectiveSnapshot = committedSnapshot
			?? (decision.action === 'update-session'
				? applySnapshotPatch(snapshot, decision.snapshotPatch, observation.observedAt)
				: snapshot);

		if (decision.action === 'update-session') {
			return {
				accepted: true,
				outcome: 'promoted',
				sessionStatus: effectiveSnapshot.status,
				waitingForInput: effectiveSnapshot.waitingForInput
			};
		}

		return {
			accepted: true,
			outcome: 'recorded',
			...(decision.action === 'record-observation-only' ? { reason: decision.reason } : {}),
			sessionStatus: effectiveSnapshot.status,
			waitingForInput: effectiveSnapshot.waitingForInput
		};
	}
}

function createScopedEventKey(scope: AgentSessionSignalScope, eventId: string): string {
	return `${scope.agentSessionId}:${eventId}`;
}

function applySnapshotPatch(
	snapshot: AgentSessionSnapshot,
	patch: Partial<AgentSessionSnapshot>,
	updatedAt: string
): AgentSessionSnapshot {
	return {
		...snapshot,
		...patch,
		progress: patch.progress ?? snapshot.progress,
		updatedAt
	};
}
