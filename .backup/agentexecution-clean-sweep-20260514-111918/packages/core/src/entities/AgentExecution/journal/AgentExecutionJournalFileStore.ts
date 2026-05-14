import * as path from 'node:path';
import { FilesystemAdapter } from '../../../lib/filesystem/FilesystemAdapter.js';
import {
    AgentExecutionJournalReferenceSchema,
    AgentExecutionJournalRecordSchema,
    type AgentExecutionJournalRecordType,
    type AgentExecutionJournalReferenceType,
    type AgentExecutionJournalStore
} from './AgentExecutionJournalSchema.js';

export type AgentExecutionJournalFileStorePath = {
    rootPath: string;
    relativePath: string;
};

export type AgentExecutionJournalFileStoreOptions = {
    resolvePath(reference: AgentExecutionJournalReferenceType): AgentExecutionJournalFileStorePath;
    filesystem?: FilesystemAdapter;
};

export class AgentExecutionJournalFileStore implements AgentExecutionJournalStore {
    private readonly filesystem: FilesystemAdapter;

    public constructor(private readonly options: AgentExecutionJournalFileStoreOptions) {
        this.filesystem = options.filesystem ?? new FilesystemAdapter();
    }

    public async ensureJournal(reference: AgentExecutionJournalReferenceType): Promise<void> {
        await this.filesystem.ensureTextFile(this.resolveJournalPath(reference));
    }

    public async appendRecord(
        reference: AgentExecutionJournalReferenceType,
        record: AgentExecutionJournalRecordType
    ): Promise<void> {
        const journalPath = this.resolveJournalPath(reference);
        const parsed = AgentExecutionJournalRecordSchema.parse(record);
        await this.filesystem.appendTextFile(journalPath, `${JSON.stringify(parsed)}\n`);
    }

    public async readRecords(reference: AgentExecutionJournalReferenceType): Promise<AgentExecutionJournalRecordType[]> {
        const journalPath = this.resolveJournalPath(reference);
        const content = await this.filesystem.readTextFile(journalPath);
        if (content === undefined) {
            return [];
        }
        return content
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line, index) => parseJournalLine(journalPath, line, index + 1));
    }

    public resolveJournalPath(reference: AgentExecutionJournalReferenceType): string {
        return resolveAgentExecutionJournalFilePath(reference, this.options.resolvePath(reference));
    }
}

export function resolveAgentExecutionJournalFilePath(
    reference: AgentExecutionJournalReferenceType,
    target: AgentExecutionJournalFileStorePath
): string {
    AgentExecutionJournalReferenceSchema.parse(reference);
    const rootPath = path.resolve(requireNonEmpty(target.rootPath, 'AgentExecution journal root path'));
    const relativeTargetPath = requireNonEmpty(target.relativePath, 'AgentExecution journal relative path');
    if (path.isAbsolute(relativeTargetPath) || relativeTargetPath.split('/').includes('..')) {
        throw new Error(`AgentExecution journal path '${relativeTargetPath}' must stay within journal root '${rootPath}'.`);
    }
    const journalPath = path.resolve(rootPath, relativeTargetPath);
    const relativePath = path.relative(rootPath, journalPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`AgentExecution journal path '${relativeTargetPath}' must stay within journal root '${rootPath}'.`);
    }
    return journalPath;
}

function parseJournalLine(journalPath: string, line: string, lineNumber: number): AgentExecutionJournalRecordType {
    try {
        return AgentExecutionJournalRecordSchema.parse(JSON.parse(line) as unknown);
    } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        throw new Error(`AgentExecution interaction journal '${journalPath}' has invalid JSONL at line ${lineNumber}.${detail}`);
    }
}

function requireNonEmpty(value: string | undefined, label: string): string {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(`${label} is required.`);
    }
    return normalized;
}
