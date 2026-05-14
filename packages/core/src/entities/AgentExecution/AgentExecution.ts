import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
    createEntityId,
    createEntityIdentitySegment,
    Entity,
    type EntityExecutionContext,
    type EntityMethodAvailability
} from '../Entity/Entity.js';
import {
    agentExecutionEntityName,
    agentExecutionJournalTableName,
    agentExecutionTableName,
    AgentExecutionInputSchema,
    AgentExecutionJournalRecordInputSchema,
    AgentExecutionJournalRecordStorageSchema,
    AgentExecutionLocatorSchema,
    AgentExecutionSchema,
    AgentExecutionSendMessageAcknowledgementSchema,
    AgentExecutionSendMessageInputSchema,
    type AgentExecutionInputType,
    type AgentExecutionJournalRecordInputType,
    type AgentExecutionJournalRecordStorageType,
    type AgentExecutionLocatorType,
    type AgentExecutionOwnerEntityType,
    type AgentExecutionSendMessageAcknowledgementType,
    type AgentExecutionSendMessageInputType,
    type AgentExecutionType
} from './AgentExecutionSchema.js';

export type AgentExecutionJournalWriterPlaceholder = {
    appendMessageAccepted?(input: {
        execution: AgentExecutionType;
        message: AgentExecutionSendMessageInputType;
        messageId: string;
        recordedAt: string;
    }): Promise<void> | void;
};

type AgentExecutionEntityContext = EntityExecutionContext & {
    agentExecutionJournalWriter?: AgentExecutionJournalWriterPlaceholder;
};

type AgentExecutionRegistryReader = {
    resolve?(locator: AgentExecutionLocatorType): Promise<AgentExecutionType | AgentExecution | undefined> | AgentExecutionType | AgentExecution | undefined;
    read?(locator: AgentExecutionLocatorType): Promise<AgentExecutionType | AgentExecution | undefined> | AgentExecutionType | AgentExecution | undefined;
};

export type AgentExecutionProcessStatus = 'starting' | 'running' | 'completed' | 'failed' | 'terminated';

export type AgentExecutionProcessLaunchInput = {
    command: string;
    args?: string[];
    workingDirectory: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
};

export type AgentExecutionProcessSnapshot = {
    command: string;
    args: string[];
    workingDirectory: string;
    pid?: number;
    status: AgentExecutionProcessStatus;
    startedAt: string;
    updatedAt: string;
    endedAt?: string;
    exitCode?: number;
    signal?: NodeJS.Signals;
    failureMessage?: string;
    stdout: string;
    stderr: string;
};

export class AgentExecution extends Entity<AgentExecutionType, string> {
    public static override readonly entityName = agentExecutionEntityName;
    private processHandle: ChildProcessWithoutNullStreams | undefined;
    private processSnapshot: AgentExecutionProcessSnapshot | undefined;
    private processExitPromise: Promise<AgentExecutionProcessSnapshot> | undefined;

    public constructor(data: AgentExecutionType) {
        super(AgentExecutionSchema.parse(data));
    }

    public override get id(): string {
        return this.data.id;
    }

    public get agentExecutionId(): string {
        return this.data.agentExecutionId;
    }

    public get ownerEntity(): AgentExecutionOwnerEntityType {
        return this.data.ownerEntity;
    }

    public get ownerId(): string {
        return this.data.ownerId;
    }

    public static createEntityId(input: {
        ownerEntity: AgentExecutionOwnerEntityType;
        ownerId: string;
        agentExecutionId: string;
    }): string {
        return createEntityId(
            agentExecutionTableName,
            [
                input.ownerEntity.toLowerCase(),
                createEntityIdentitySegment(input.ownerId),
                createEntityIdentitySegment(input.agentExecutionId)
            ].filter(Boolean).join('-')
        );
    }

    public static createData(input: AgentExecutionInputType): AgentExecutionType {
        const payload = AgentExecutionInputSchema.parse(input);
        const agentExecutionId = payload.agentExecutionId ?? randomUUID();
        const now = new Date().toISOString();
        return AgentExecutionSchema.parse({
            id: AgentExecution.createEntityId({
                ownerEntity: payload.ownerEntity,
                ownerId: payload.ownerId,
                agentExecutionId
            }),
            agentExecutionId,
            ownerEntity: payload.ownerEntity,
            ownerId: payload.ownerId,
            agentId: payload.agentId,
            lifecycle: 'starting',
            attention: 'autonomous',
            activity: 'idle',
            messageRegistry: payload.messageRegistry,
            transportState: payload.transportState,
            mcpAvailability: payload.mcpAvailability,
            journal: payload.journal ?? {
                journalId: AgentExecution.createJournalId(payload.ownerEntity, payload.ownerId, agentExecutionId),
                ownerEntity: payload.ownerEntity,
                ownerId: payload.ownerId,
                agentExecutionId
            },
            ...(payload.lineage ? { lineage: payload.lineage } : {}),
            createdAt: now,
            updatedAt: now
        });
    }

    public static async resolve(payload: unknown, context: EntityExecutionContext): Promise<AgentExecution> {
        const locator = AgentExecutionLocatorSchema.parse(payload);
        const registry = context.agentExecutionRegistry as unknown as AgentExecutionRegistryReader | undefined;
        if (!registry) {
            throw new Error('AgentExecution resolution requires an AgentExecutionRegistry in the Entity execution context.');
        }

        const resolved = await AgentExecution.readFromRegistry(registry, locator);
        if (!resolved) {
            throw new Error('AgentExecution could not be resolved from the provided locator.');
        }
        return resolved instanceof AgentExecution
            ? resolved
            : new AgentExecution(AgentExecutionSchema.parse(resolved));
    }

    public static async read(payload: unknown, context: EntityExecutionContext): Promise<AgentExecutionType> {
        return (await AgentExecution.resolve(payload, context)).toData();
    }

    public canSendMessage(): EntityMethodAvailability {
        if (['completed', 'failed', 'cancelled', 'terminated'].includes(this.data.lifecycle)) {
            return {
                available: false,
                reason: `AgentExecution '${this.agentExecutionId}' is ${this.data.lifecycle}.`
            };
        }
        return { available: true };
    }

    public canStartProcess(): EntityMethodAvailability {
        if (this.processHandle) {
            return this.unavailable(`AgentExecution '${this.agentExecutionId}' already has a running process.`);
        }
        if (['completed', 'failed', 'cancelled', 'terminated'].includes(this.data.lifecycle)) {
            return this.unavailable(`AgentExecution '${this.agentExecutionId}' is ${this.data.lifecycle}.`);
        }
        return this.available();
    }

    public async startProcess(input: AgentExecutionProcessLaunchInput): Promise<AgentExecutionProcessSnapshot> {
        const availability = this.canStartProcess();
        if (!availability.available) {
            throw new Error(availability.reason ?? `AgentExecution '${this.agentExecutionId}' cannot start a process.`);
        }

        const command = input.command.trim();
        if (!command) {
            throw new Error('AgentExecution process launch requires a command.');
        }
        const workingDirectory = input.workingDirectory.trim();
        if (!workingDirectory) {
            throw new Error('AgentExecution process launch requires a workingDirectory.');
        }

        const startedAt = new Date().toISOString();
        this.processSnapshot = {
            command,
            args: input.args ? [...input.args] : [],
            workingDirectory,
            status: 'starting',
            startedAt,
            updatedAt: startedAt,
            stdout: '',
            stderr: ''
        };
        this.updateRuntimeState({ lifecycle: 'starting', activity: 'executing' });

        const child = spawn(command, input.args ?? [], {
            cwd: workingDirectory,
            env: input.env ?? process.env,
            stdio: 'pipe'
        });
        this.processHandle = child;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string | Buffer) => this.appendProcessOutput('stdout', chunk));
        child.stderr.on('data', (chunk: string | Buffer) => this.appendProcessOutput('stderr', chunk));

        this.processExitPromise = new Promise<AgentExecutionProcessSnapshot>((resolve) => {
            child.once('error', (error) => {
                resolve(this.finishProcess({ status: 'failed', failureMessage: error.message }));
            });
            child.once('close', (exitCode, signal) => {
                if (this.processSnapshot?.status === 'terminated') {
                    resolve(this.finishProcess({
                        status: 'terminated',
                        ...(exitCode !== null ? { exitCode } : {}),
                        ...(signal ? { signal } : {})
                    }));
                    return;
                }
                if (exitCode === 0) {
                    resolve(this.finishProcess({
                        status: 'completed',
                        exitCode: 0,
                        ...(signal ? { signal } : {})
                    }));
                    return;
                }
                resolve(this.finishProcess({
                    status: 'failed',
                    ...(exitCode !== null ? { exitCode } : {}),
                    ...(signal ? { signal } : {}),
                    failureMessage: `Process exited with status ${String(exitCode ?? signal ?? 'unknown')}.`
                }));
            });
        });

        if (input.stdin !== undefined) {
            child.stdin.write(input.stdin);
        }
        child.stdin.end();

        await new Promise<void>((resolve, reject) => {
            child.once('spawn', () => {
                this.processSnapshot = AgentExecution.cloneProcessSnapshot({
                    ...this.requireProcessSnapshot(),
                    status: 'running',
                    updatedAt: new Date().toISOString(),
                    ...(child.pid !== undefined ? { pid: child.pid } : {})
                });
                this.updateRuntimeState({ lifecycle: 'running', activity: 'executing' });
                resolve();
            });
            child.once('error', reject);
        });

        return this.getProcessSnapshotOrThrow();
    }

    public async stopProcess(reason = 'Stopped by operator.'): Promise<AgentExecutionProcessSnapshot> {
        const child = this.processHandle;
        if (!child) {
            return this.getProcessSnapshotOrThrow();
        }

        const now = new Date().toISOString();
        this.processSnapshot = AgentExecution.cloneProcessSnapshot({
            ...this.requireProcessSnapshot(),
            status: 'terminated',
            failureMessage: reason,
            updatedAt: now
        });
        child.kill('SIGTERM');
        return await this.waitForProcessExit(5_000);
    }

    public async waitForProcessExit(timeoutMs = 30_000): Promise<AgentExecutionProcessSnapshot> {
        if (!this.processExitPromise) {
            return this.getProcessSnapshotOrThrow();
        }
        let timeoutHandle: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                this.processExitPromise,
                new Promise<AgentExecutionProcessSnapshot>((_, reject) => {
                    timeoutHandle = setTimeout(() => reject(new Error(`AgentExecution process did not exit within ${timeoutMs}ms.`)), timeoutMs);
                })
            ]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    public getProcessSnapshot(): AgentExecutionProcessSnapshot | undefined {
        return this.processSnapshot ? structuredClone(this.processSnapshot) : undefined;
    }

    public appendJournalRecord(input: AgentExecutionJournalRecordInputType): AgentExecutionJournalRecordStorageType {
        const payload = AgentExecutionJournalRecordInputSchema.parse(input);
        const sequence = this.data.journal.lastSequence + 1;
        const occurredAt = payload.occurredAt ?? new Date().toISOString();
        const record = AgentExecutionJournalRecordStorageSchema.parse({
            id: AgentExecution.createJournalRecordId(this.data.journal.journalId, sequence),
            journalId: this.data.journal.journalId,
            ownerEntity: this.data.ownerEntity,
            ownerId: this.data.ownerId,
            agentExecutionId: this.data.agentExecutionId,
            sequence,
            kind: payload.kind,
            occurredAt,
            ...(payload.summary ? { summary: payload.summary } : {}),
            ...(payload.payload ? { payload: payload.payload } : {})
        });

        this.data = AgentExecutionSchema.parse({
            ...this.data,
            journal: {
                ...this.data.journal,
                recordCount: this.data.journal.recordCount + 1,
                lastSequence: sequence
            },
            updatedAt: occurredAt
        });

        return record;
    }

    public async sendMessage(
        payload: unknown,
        context?: AgentExecutionEntityContext
    ): Promise<AgentExecutionSendMessageAcknowledgementType> {
        const input = AgentExecutionSendMessageInputSchema.parse(payload);
        const messageId = input.message.messageId ?? randomUUID();
        const now = new Date().toISOString();
        await context?.agentExecutionJournalWriter?.appendMessageAccepted?.({
            execution: this.toData(),
            message: AgentExecutionSendMessageInputSchema.parse({
                ...input,
                message: {
                    ...input.message,
                    messageId
                }
            }),
            messageId,
            recordedAt: now
        });

        this.data = AgentExecutionSchema.parse({
            ...this.data,
            activity: input.message.startsTurn ? 'awaiting-agent-response' : this.data.activity,
            updatedAt: now
        });

        return AgentExecutionSendMessageAcknowledgementSchema.parse({
            ok: true,
            entity: agentExecutionEntityName,
            method: 'sendMessage',
            id: this.id,
            agentExecutionId: this.agentExecutionId,
            messageId,
            accepted: true
        });
    }

    private static createJournalId(
        ownerEntity: AgentExecutionOwnerEntityType,
        ownerId: string,
        agentExecutionId: string
    ): string {
        return [
            ownerEntity.toLowerCase(),
            createEntityIdentitySegment(ownerId),
            createEntityIdentitySegment(agentExecutionId),
            'journal'
        ].filter(Boolean).join('-');
    }

    private static createJournalRecordId(journalId: string, sequence: number): string {
        return createEntityId(
            agentExecutionJournalTableName,
            `${createEntityIdentitySegment(journalId)}-${sequence.toString().padStart(8, '0')}`
        );
    }

    private appendProcessOutput(channel: 'stdout' | 'stderr', chunk: string | Buffer): void {
        const snapshot = this.requireProcessSnapshot();
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        this.processSnapshot = AgentExecution.cloneProcessSnapshot({
            ...snapshot,
            [channel]: `${snapshot[channel]}${text}`,
            updatedAt: new Date().toISOString()
        });
    }

    private finishProcess(input: {
        status: Exclude<AgentExecutionProcessStatus, 'starting' | 'running'>;
        exitCode?: number;
        signal?: NodeJS.Signals;
        failureMessage?: string;
    }): AgentExecutionProcessSnapshot {
        const endedAt = new Date().toISOString();
        const snapshot = this.requireProcessSnapshot();
        this.processHandle = undefined;
        this.processSnapshot = AgentExecution.cloneProcessSnapshot({
            ...snapshot,
            status: input.status,
            endedAt,
            updatedAt: endedAt,
            ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
            ...(input.failureMessage ? { failureMessage: input.failureMessage } : {})
        });
        this.updateRuntimeState({
            lifecycle: input.status === 'completed' ? 'completed' : input.status === 'terminated' ? 'terminated' : 'failed',
            activity: 'idle'
        });
        return this.getProcessSnapshotOrThrow();
    }

    private updateRuntimeState(input: {
        lifecycle: AgentExecutionType['lifecycle'];
        activity: AgentExecutionType['activity'];
    }): void {
        this.data = AgentExecutionSchema.parse({
            ...this.data,
            lifecycle: input.lifecycle,
            activity: input.activity,
            updatedAt: new Date().toISOString()
        });
    }

    private requireProcessSnapshot(): AgentExecutionProcessSnapshot {
        if (!this.processSnapshot) {
            throw new Error(`AgentExecution '${this.agentExecutionId}' has no process snapshot.`);
        }
        return this.processSnapshot;
    }

    private getProcessSnapshotOrThrow(): AgentExecutionProcessSnapshot {
        return structuredClone(this.requireProcessSnapshot());
    }

    private static cloneProcessSnapshot(snapshot: AgentExecutionProcessSnapshot): AgentExecutionProcessSnapshot {
        return structuredClone(snapshot);
    }

    private static async readFromRegistry(
        registry: AgentExecutionRegistryReader,
        locator: AgentExecutionLocatorType
    ): Promise<AgentExecutionType | AgentExecution | undefined> {
        if (typeof registry.resolve === 'function') {
            return registry.resolve(locator);
        }
        if (typeof registry.read === 'function') {
            return registry.read(locator);
        }
        throw new Error('AgentExecutionRegistry must expose resolve() or read() for AgentExecution entity resolution.');
    }
}