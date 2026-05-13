import { randomUUID } from 'node:crypto';
import { AgentExecution } from '../../../entities/AgentExecution/AgentExecution.js';
import type {
    AgentExecutionEvent,
    AgentExecutionObservation,
    AgentExecutionObservationAddress,
    AgentExecutionScope,
    AgentExecutionType
} from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolTypes.js';
import type { AgentExecutionJournalRecordType } from '../../../entities/AgentExecution/journal/AgentExecutionJournalSchema.js';
import { replayAgentExecutionJournal } from '../../../entities/AgentExecution/journal/AgentExecutionJournalReplayer.js';
import type { AgentExecutionJournalWriter } from '../../../entities/AgentExecution/journal/AgentExecutionJournalWriter.js';
import {
    AgentExecutionObservationAckSchema,
    type AgentExecutionObservationAckType
} from '../../../entities/AgentExecution/protocol/AgentExecutionProtocolSchema.js';
import {
    AgentExecutionObservationLedger,
    AgentExecutionObservationPolicy
} from '../../../entities/AgentExecution/runtime/AgentExecutionObservationPolicy.js';
import { deriveActivityStateFromProgressState } from '../../../entities/AgentExecution/state/AgentExecutionActivitySemantics.js';
import type { AgentAdapter } from './AgentAdapter.js';
import { AgentExecutionObservationRouter } from './signals/AgentExecutionObservationRouter.js';

export const AGENT_EXECUTION_IDLE_QUIET_PERIOD_MS = 1_500;
const MAX_DIRECT_AGENT_MESSAGE_CHARS = 1_024;

export type AgentExecutionManagedObservationState = {
    execution: AgentExecution;
    adapter: AgentAdapter;
    retainedProcessOutput: string;
    retainProcessOutput: boolean;
    journalScope: AgentExecutionScope;
    parseAgentSignals: boolean;
    observationLedger: AgentExecutionObservationLedger;
    observationPolicy: AgentExecutionObservationPolicy;
    observationQueue: Promise<void>;
    idleObservationTimer: NodeJS.Timeout | undefined;
};

type AgentExecutionObservationCallbacks = {
    publishJournalRecord(record: AgentExecutionJournalRecordType | undefined): void;
    disposeManagedExecution(): void;
};

export class AgentExecutionObservationCoordinator {
    private readonly journalWriter: AgentExecutionJournalWriter;
    private readonly observationRouter: AgentExecutionObservationRouter;

    public constructor(input: {
        journalWriter: AgentExecutionJournalWriter;
        observationRouter: AgentExecutionObservationRouter;
    }) {
        this.journalWriter = input.journalWriter;
        this.observationRouter = input.observationRouter;
    }

    public handleExecutionEvent(
        managed: AgentExecutionManagedObservationState,
        event: AgentExecutionEvent,
        callbacks: AgentExecutionObservationCallbacks
    ): void {
        switch (event.type) {
            case 'execution.message':
                if (event.channel !== 'stdout' && event.channel !== 'stderr') {
                    return;
                }
                if (managed.retainProcessOutput) {
                    managed.retainedProcessOutput = appendRetainedProcessOutput(managed.retainedProcessOutput, event.text);
                }
                this.routeProcessOutput(managed, event.execution, event.channel, event.text, callbacks);
                this.syncIdleObservationTimer(managed, managed.execution.getExecution(), callbacks);
                return;
            case 'execution.completed':
            case 'execution.failed':
                this.clearIdleObservationTimer(managed);
                const usageObservation = this.routeUsageObservation(managed, event.execution, callbacks);
                void managed.observationQueue
                    .then(() => usageObservation)
                    .finally(() => callbacks.disposeManagedExecution());
                return;
            case 'execution.cancelled':
            case 'execution.terminated':
                this.clearIdleObservationTimer(managed);
                callbacks.disposeManagedExecution();
                return;
            case 'execution.attached':
            case 'execution.started':
            case 'execution.updated':
                this.syncIdleObservationTimer(managed, event.execution, callbacks);
                return;
        }
    }

    public async hydrateObservationLedger(agentExecutionId: string, scope: AgentExecutionScope): Promise<AgentExecutionObservationLedger> {
        const records = await this.journalWriter.readRecords({ agentExecutionId, scope });
        return new AgentExecutionObservationLedger(replayAgentExecutionJournal(records).processedObservationIds);
    }

    public syncIdleObservationTimer(
        managed: AgentExecutionManagedObservationState,
        snapshot: AgentExecutionType,
        callbacks: AgentExecutionObservationCallbacks
    ): void {
        if (!shouldArmIdleObservationTimer(snapshot)) {
            this.clearIdleObservationTimer(managed);
            return;
        }

        this.clearIdleObservationTimer(managed);
        managed.idleObservationTimer = setTimeout(() => {
            managed.idleObservationTimer = undefined;
            const currentSnapshot = managed.execution.getExecution();
            if (!shouldArmIdleObservationTimer(currentSnapshot)) {
                return;
            }
            void managed.observationQueue
                .then(() => this.applyObservations(managed, [createDaemonIdleObservation(managed.execution.getExecution())], callbacks));
        }, AGENT_EXECUTION_IDLE_QUIET_PERIOD_MS);
    }

    public clearIdleObservationTimer(managed: AgentExecutionManagedObservationState): void {
        if (!managed.idleObservationTimer) {
            return;
        }
        clearTimeout(managed.idleObservationTimer);
        managed.idleObservationTimer = undefined;
    }

    public dispose(managed: AgentExecutionManagedObservationState): void {
        this.clearIdleObservationTimer(managed);
    }

    public routeTransportObservation(
        managed: AgentExecutionManagedObservationState,
        observation: AgentExecutionObservation,
        callbacks: AgentExecutionObservationCallbacks
    ): Promise<AgentExecutionObservationAckType> {
        return this.enqueueObservation(managed, observation, callbacks);
    }

    private routeProcessOutput(
        managed: AgentExecutionManagedObservationState,
        snapshot: AgentExecutionType,
        channel: 'stdout' | 'stderr',
        line: string,
        callbacks: AgentExecutionObservationCallbacks
    ): void {
        const observationAddress = toObservationAddress(snapshot);
        const markerPrefix = AgentExecution.createProtocolDescriptorForExecution(snapshot).owner.markerPrefix;
        if (managed.parseAgentSignals && channel === 'stdout') {
            const observations = this.observationRouter.route({
                kind: 'agent-signal',
                line,
                address: observationAddress,
                markerPrefix,
                observedAt: snapshot.updatedAt
            });
            void this.applyObservations(managed, observations, callbacks);
            if (observations.length === 0 && isDirectAgentProseLine(line)) {
                void this.applyObservations(managed, [createDaemonAgentMessageObservation(snapshot, line)], callbacks);
            }
        }
        for (const observation of managed.adapter.parseProcessOutputLine(line)) {
            void this.applyObservations(managed, this.observationRouter.route({
                kind: 'provider-output',
                observation,
                address: observationAddress,
                observedAt: snapshot.updatedAt
            }), callbacks);
        }
        void this.applyObservations(managed, this.observationRouter.route({
            kind: 'terminal-output',
            line,
            channel,
            address: observationAddress,
            markerPrefix,
            observedAt: snapshot.updatedAt
        }), callbacks);
    }

    private async routeUsageObservation(
        managed: AgentExecutionManagedObservationState,
        snapshot: AgentExecutionType,
        callbacks: AgentExecutionObservationCallbacks
    ): Promise<void> {
        if (!managed.retainProcessOutput) {
            return;
        }
        const observationAddress = toObservationAddress(snapshot);
        const usageObservation = managed.adapter.parseAgentExecutionUsageContent(managed.retainedProcessOutput);
        if (!usageObservation) {
            return;
        }
        await this.applyObservations(managed, this.observationRouter.route({
            kind: 'provider-output',
            observation: usageObservation,
            address: observationAddress,
            observedAt: snapshot.updatedAt
        }), callbacks);
    }

    private async applyObservations(
        managed: AgentExecutionManagedObservationState,
        observations: AgentExecutionObservation[],
        callbacks: AgentExecutionObservationCallbacks
    ): Promise<void> {
        for (const observation of observations) {
            await this.enqueueObservation(managed, observation, callbacks);
        }
    }

    private enqueueObservation(
        managed: AgentExecutionManagedObservationState,
        observation: AgentExecutionObservation,
        callbacks: AgentExecutionObservationCallbacks
    ): Promise<AgentExecutionObservationAckType> {
        const queued = managed.observationQueue.then(() => this.applyObservation(managed, observation, callbacks));
        managed.observationQueue = queued.then(() => undefined, () => undefined);
        return queued;
    }

    private async applyObservation(
        managed: AgentExecutionManagedObservationState,
        observation: AgentExecutionObservation,
        callbacks: AgentExecutionObservationCallbacks
    ): Promise<AgentExecutionObservationAckType> {
        const awaitingResponseToMessageId = managed.execution.toData().awaitingResponseToMessageId;
        const eventId = readObservationEventId(observation);
        if (managed.observationLedger.has(observation.observationId)) {
            return AgentExecutionObservationAckSchema.parse({
                status: 'duplicate',
                agentExecutionId: managed.execution.agentExecutionId,
                eventId,
                observationId: observation.observationId,
                reason: `Observation '${observation.observationId}' was already processed.`
            });
        }
        for (const evidence of deriveTransportEvidenceFromObservation(observation)) {
            await this.journalWriter.appendTransportEvidence({
                agentExecutionId: managed.execution.agentExecutionId,
                scope: managed.journalScope,
                ...evidence
            });
        }
        callbacks.publishJournalRecord(await this.journalWriter.appendObservation({
            agentExecutionId: managed.execution.agentExecutionId,
            scope: managed.journalScope,
            observation
        }));
        const decision = managed.observationPolicy.evaluate({
            execution: managed.execution.getExecution(),
            observation
        });
        callbacks.publishJournalRecord(await this.journalWriter.appendDecision({
            agentExecutionId: managed.execution.agentExecutionId,
            scope: managed.journalScope,
            observationId: observation.observationId,
            decision
        }));
        if (decision.action === 'reject') {
            return AgentExecutionObservationAckSchema.parse({
                status: isDuplicateObservationRejection(decision.reason) ? 'duplicate' : 'rejected',
                agentExecutionId: managed.execution.agentExecutionId,
                eventId,
                observationId: observation.observationId,
                reason: decision.reason
            });
        }
        if (decision.action === 'update-execution') {
            const currentInputRequestId = decision.patch.waitingForInput === true
                ? observation.observationId
                : decision.patch.waitingForInput === false
                    ? null
                    : undefined;
            callbacks.publishJournalRecord(await this.journalWriter.appendStateChanged({
                agentExecutionId: managed.execution.agentExecutionId,
                scope: managed.journalScope,
                decision,
                ...(currentInputRequestId !== undefined ? { currentInputRequestId } : {}),
                ...(shouldClearAwaitingResponseFromObservation(observation) ? { awaitingResponseToMessageId: null } : {})
            }));
            callbacks.publishJournalRecord(await this.journalWriter.appendActivityUpdated({
                agentExecutionId: managed.execution.agentExecutionId,
                scope: managed.journalScope,
                decision
            }));
        }
        managed.execution.applySignalObservation(observation, decision);
        if (awaitingResponseToMessageId !== undefined && awaitingResponseToMessageId !== null && shouldClearAwaitingResponseFromObservation(observation)) {
            if (decision.action !== 'update-execution') {
                callbacks.publishJournalRecord(await this.journalWriter.appendExecutionStateChanged({
                    agentExecutionId: managed.execution.agentExecutionId,
                    scope: managed.journalScope,
                    lifecycle: managed.execution.getExecution().status,
                    attention: managed.execution.getExecution().attention,
                    activity: mapProgressStateToSemanticActivity(managed.execution.getExecution().progress.state),
                    awaitingResponseToMessageId: null
                }));
            }
            managed.execution.setAwaitingResponseToMessageId(null, observation.observedAt);
        }
        return AgentExecutionObservationAckSchema.parse({
            status: decision.action === 'record-observation-only' ? 'recorded-only' : 'promoted',
            agentExecutionId: managed.execution.agentExecutionId,
            eventId,
            observationId: observation.observationId,
            ...(decision.action === 'record-observation-only' ? { reason: decision.reason } : {})
        });
    }

}

function appendRetainedProcessOutput(current: string, line: string): string {
    if (!line) {
        return current;
    }

    const next = current ? `${current}\n${line}` : line;
    if (next.length <= 262_144) {
        return next;
    }

    return next.slice(next.length - 262_144);
}

function deriveTransportEvidenceFromObservation(observation: AgentExecutionObservation): Array<{
    evidenceType: 'provider-payload' | 'pty-snippet';
    origin: 'provider-output' | 'terminal-heuristic';
    content?: string;
    payload?: Record<string, unknown>;
}> {
    if (observation.route.origin === 'provider-output') {
        return [{
            evidenceType: 'provider-payload',
            origin: 'provider-output',
            ...(observation.rawText ? { content: observation.rawText } : {}),
            payload: {
                observationId: observation.observationId,
                signalType: observation.signal.type,
                ...(observation.signal.type === 'diagnostic' && observation.signal.code
                    ? { signalCode: observation.signal.code }
                    : {})
            }
        }];
    }

    if (observation.route.origin === 'terminal-output' && observation.rawText) {
        return [{
            evidenceType: 'pty-snippet',
            origin: 'terminal-heuristic',
            content: observation.rawText,
            payload: {
                observationId: observation.observationId,
                signalType: observation.signal.type
            }
        }];
    }

    return [];
}

function shouldArmIdleObservationTimer(snapshot: AgentExecutionType): boolean {
    if (snapshot.status !== 'starting' && snapshot.status !== 'running') {
        return false;
    }
    if (snapshot.waitingForInput) {
        return false;
    }
    return snapshot.progress.state === 'initializing'
        || snapshot.progress.state === 'unknown'
        || snapshot.progress.state === 'working';
}

function createDaemonAgentMessageObservation(
    snapshot: AgentExecutionType,
    text: string
): AgentExecutionObservation {
    const observedAt = new Date().toISOString();
    return {
        observationId: `daemon:${snapshot.agentExecutionId}:message:${randomUUID()}`,
        observedAt,
        signal: {
            type: 'message',
            channel: 'agent',
            text,
            source: 'daemon-authoritative',
            confidence: 'authoritative'
        },
        route: {
            origin: 'daemon',
            address: toObservationAddress(snapshot)
        },
        rawText: text
    };
}

function createDaemonIdleObservation(snapshot: AgentExecutionType): AgentExecutionObservation {
    const observedAt = new Date().toISOString();
    return {
        observationId: `daemon:${snapshot.agentExecutionId}:idle:${randomUUID()}`,
        observedAt,
        signal: {
            type: 'status',
            phase: 'idle',
            summary: 'No further agent output observed; execution is idle.',
            source: 'daemon-authoritative',
            confidence: 'authoritative'
        },
        route: {
            origin: 'daemon',
            address: toObservationAddress(snapshot)
        }
    };
}

function shouldClearAwaitingResponseFromObservation(observation: AgentExecutionObservation): boolean {
    switch (observation.signal.type) {
        case 'usage':
        case 'diagnostic':
            return false;
        case 'message':
            return observation.signal.channel === 'agent';
        default:
            return true;
    }
}

function mapProgressStateToSemanticActivity(progressState: AgentExecutionType['progress']['state']): 'idle' | 'planning' | 'communicating' | 'executing' | undefined {
    const activityState = deriveActivityStateFromProgressState(progressState);
    if (activityState === 'idle' || activityState === 'communicating' || activityState === 'executing' || activityState === 'planning') {
        return activityState;
    }
    return undefined;
}

function toObservationAddress(snapshot: AgentExecutionType): AgentExecutionObservationAddress {
    return {
        agentExecutionId: snapshot.agentExecutionId,
        scope: snapshot.scope
    };
}

function isDirectAgentProseLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }
    if (trimmed.length > MAX_DIRECT_AGENT_MESSAGE_CHARS) {
        return false;
    }
    return !/^@(system|repository|mission|task|artifact)::/u.test(trimmed);
}

function readObservationEventId(observation: AgentExecutionObservation): string {
    const prefix = 'agent-signal:';
    if (observation.observationId.startsWith(prefix)) {
        const eventId = observation.observationId.slice(prefix.length).trim();
        if (eventId) {
            return eventId;
        }
    }
    return observation.observationId;
}

function isDuplicateObservationRejection(reason: string): boolean {
    return /was already processed/u.test(reason);
}