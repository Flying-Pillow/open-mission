import { AgentExecutionJournalWriter } from '../../../../entities/AgentExecution/AgentExecutionJournalWriter.js';
import type {
    AgentExecutionJournalReferenceType,
    AgentExecutionJournalStore
} from '../../../../entities/AgentExecution/AgentExecutionJournalSchema.js';
import type { AgentExecutionJournalRecordType } from '../../../../entities/AgentExecution/AgentExecutionJournalSchema.js';

export function createMemoryAgentExecutionJournalWriter(options: {
    ensureError?: Error;
    appendError?: Error;
} = {}): {
    journalWriter: AgentExecutionJournalWriter;
    recordsByJournalId: Map<string, AgentExecutionJournalRecordType[]>;
} {
    const recordsByJournalId = new Map<string, AgentExecutionJournalRecordType[]>();
    const store: AgentExecutionJournalStore = {
        ensureJournal: async (reference) => {
            if (options.ensureError) {
                throw options.ensureError;
            }
            ensureRecords(recordsByJournalId, reference);
        },
        appendRecord: async (reference, record) => {
            if (options.appendError) {
                throw options.appendError;
            }
            ensureRecords(recordsByJournalId, reference).push(record);
        },
        readRecords: async (reference) => [...ensureRecords(recordsByJournalId, reference)]
    };

    return {
        journalWriter: new AgentExecutionJournalWriter({ resolveStore: () => store }),
        recordsByJournalId
    };
}

function ensureRecords(
    recordsByJournalId: Map<string, AgentExecutionJournalRecordType[]>,
    reference: AgentExecutionJournalReferenceType
): AgentExecutionJournalRecordType[] {
    let records = recordsByJournalId.get(reference.journalId);
    if (!records) {
        records = [];
        recordsByJournalId.set(reference.journalId, records);
    }
    return records;
}