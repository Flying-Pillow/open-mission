import type { AgentExecutionSnapshot } from '../../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import { AgentExecutionObservationRouter } from './AgentExecutionObservationRouter.js';
import { AgentExecutionSignalPolicy } from './AgentExecutionSignalPolicy.js';
import type {
	AgentExecutionObservation,
	AgentExecutionSignal,
	AgentExecutionSignalDecision,
	AgentExecutionSignalScope
} from './AgentExecutionSignal.js';

type MaybePromise<T> = T | Promise<T>;

export type AgentExecutionSignalAcknowledgement = {
	accepted: boolean;
	outcome: 'promoted' | 'recorded' | 'rejected';
	reason?: string;
	sessionStatus?: AgentExecutionSnapshot['status'];
	waitingForInput?: boolean;
};

export interface AgentExecutionSignalPort {
	reportSignal(input: {
		scope: AgentExecutionSignalScope;
		eventId: string;
		signal: AgentExecutionSignal;
	}): Promise<AgentExecutionSignalAcknowledgement>;
}

export interface AgentExecutionSignalPortSink {
	getSnapshot(scope: AgentExecutionSignalScope): MaybePromise<AgentExecutionSnapshot | undefined>;
	commit(input: {
		snapshot: AgentExecutionSnapshot;
		observation: AgentExecutionObservation;
		decision: Exclude<AgentExecutionSignalDecision, { action: 'reject' }>;
	}): MaybePromise<AgentExecutionSnapshot | void>;
}

export class PolicyBoundAgentExecutionSignalPort implements AgentExecutionSignalPort {
	private readonly sink: AgentExecutionSignalPortSink;

	private readonly observationRouter: AgentExecutionObservationRouter;

	private readonly signalPolicy: AgentExecutionSignalPolicy;

	private readonly now: () => string;

	public constructor(options: {
		sink: AgentExecutionSignalPortSink;
		observationRouter?: AgentExecutionObservationRouter;
		signalPolicy?: AgentExecutionSignalPolicy;
		now?: () => string;
	}) {
		this.sink = options.sink;
		this.observationRouter = options.observationRouter ?? new AgentExecutionObservationRouter();
		this.signalPolicy = options.signalPolicy ?? new AgentExecutionSignalPolicy();
		this.now = options.now ?? (() => new Date().toISOString());
	}

	public async reportSignal(input: {
		scope: AgentExecutionSignalScope;
		eventId: string;
		signal: AgentExecutionSignal;
	}): Promise<AgentExecutionSignalAcknowledgement> {
		const snapshot = await this.sink.getSnapshot(input.scope);
		if (!snapshot) {
			return {
				accepted: false,
				outcome: 'rejected',
				reason: `Mission session '${input.scope.agentExecutionId}' is not active.`
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

function createScopedEventKey(scope: AgentExecutionSignalScope, eventId: string): string {
	return `${scope.agentExecutionId}:${eventId}`;
}

function applySnapshotPatch(
	snapshot: AgentExecutionSnapshot,
	patch: Partial<AgentExecutionSnapshot>,
	updatedAt: string
): AgentExecutionSnapshot {
	return {
		...snapshot,
		...patch,
		progress: patch.progress ?? snapshot.progress,
		updatedAt
	};
}
