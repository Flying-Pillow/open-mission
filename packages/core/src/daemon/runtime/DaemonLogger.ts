import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getDaemonLogPath } from '../daemonPaths.js';

export type DaemonLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type DaemonLogEntry = {
    timestamp: string;
    level: DaemonLogLevel;
    message: string;
    metadata?: Record<string, unknown>;
};

export class DaemonLogger {
    private queue: Promise<void> = Promise.resolve();

    public constructor(private readonly logPath = getDaemonLogPath()) { }

    public debug(message: string, metadata?: Record<string, unknown>): void {
        this.write('debug', message, metadata);
    }

    public info(message: string, metadata?: Record<string, unknown>): void {
        this.write('info', message, metadata);
    }

    public warn(message: string, metadata?: Record<string, unknown>): void {
        this.write('warn', message, metadata);
    }

    public error(message: string, metadata?: Record<string, unknown>): void {
        this.write('error', message, metadata);
    }

    public async flush(): Promise<void> {
        await this.queue;
    }

    private write(level: DaemonLogLevel, message: string, metadata: Record<string, unknown> | undefined): void {
        const entry: DaemonLogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {})
        };
        this.queue = this.queue
            .then(() => appendDaemonLogEntry(this.logPath, entry))
            .catch(() => undefined);
    }
}

export async function readDaemonLogLines(options: { maxLines?: number } = {}): Promise<string[]> {
    let content = '';
    try {
        content = await fs.readFile(getDaemonLogPath(), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const lines = content.split(/\r?\n/u).filter((line) => line.length > 0);
    const maxLines = options.maxLines ?? lines.length;
    return maxLines > 0 ? lines.slice(-maxLines) : lines;
}

async function appendDaemonLogEntry(logPath: string, entry: DaemonLogEntry): Promise<void> {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${formatDaemonLogEntry(entry)}\n`, 'utf8');
}

function formatDaemonLogEntry(entry: DaemonLogEntry): string {
    const metadata = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
    return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}${metadata}`;
}
