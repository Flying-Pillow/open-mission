import { randomUUID } from 'node:crypto';
import type { AgentExecutionScope } from '../../../entities/AgentExecution/AgentExecutionProtocolTypes.js';
import type { AgentExecutionJournalRecordType } from '../../../entities/AgentExecution/AgentExecutionJournalSchema.js';
import type { AgentExecutionJournalWriter } from '../../../entities/AgentExecution/AgentExecutionJournalWriter.js';

export type AgentExecutionFactRecordListener = (record: AgentExecutionJournalRecordType) => void | Promise<void>;

export class AgentExecutionFactRecorder {
    private readonly journalWriter: AgentExecutionJournalWriter;

    public constructor(input: {
        journalWriter: AgentExecutionJournalWriter;
    }) {
        this.journalWriter = input.journalWriter;
    }

    public async recordArtifactRead(input: {
        agentExecutionId: string;
        scope: AgentExecutionScope;
        operationName: string;
        path: string;
        onRecordAppended?: AgentExecutionFactRecordListener;
    }): Promise<{ eventId: string }> {
        const eventId = `semantic-operation:${input.operationName}:${randomUUID()}`;
        const record = await this.journalWriter.appendRuntimeFact({
            agentExecutionId: input.agentExecutionId,
            scope: input.scope,
            factType: 'artifact-read',
            path: input.path,
            detail: 'Mission fact recorder recorded an artifact-read fact.',
            payload: {
                operationName: input.operationName
            }
        });
        await input.onRecordAppended?.(record);
        return { eventId };
    }
}