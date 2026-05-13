// /apps/web/src/routes/api/runtime/daemon/logs/+server.ts: Streams daemon log lines to Open Mission web without daemon lifecycle control.
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { z } from 'zod/v4';
import { getDaemonLogPath } from '@flying-pillow/open-mission-core/daemon/daemonPaths';
import { readDaemonLogLines } from '@flying-pillow/open-mission-core/daemon/runtime/DaemonLogger';
import type { RequestHandler } from '@sveltejs/kit';

const HEARTBEAT_INTERVAL_MS = 15_000;

const daemonLogQuerySchema = z.object({
    tail: z.coerce.number().int().positive().max(500).optional()
}).strict();

function serializeSseEvent(input: {
    event: string;
    data: unknown;
}): string {
    const payload = JSON.stringify(input.data);
    return `event: ${input.event}\ndata: ${payload}\n\n`;
}

export const GET: RequestHandler = async ({ request, url }) => {
    const query = daemonLogQuerySchema.parse({
        tail: url.searchParams.get('tail') ?? undefined
    });
    const maxLines = query.tail ?? 200;
    const logPath = getDaemonLogPath();
    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let offset = await readFileSize(logPath);
    let closed = false;

    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = undefined;
        }
        fsSync.unwatchFile(logPath);
    };

    request.signal.addEventListener('abort', close, { once: true });

    const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
            const enqueue = (event: string, data: unknown) => {
                if (closed) {
                    return;
                }
                controller.enqueue(encoder.encode(serializeSseEvent({ event, data })));
            };

            enqueue('snapshot', {
                logPath,
                lines: await readDaemonLogLines({ maxLines })
            });

            heartbeat = setInterval(() => {
                enqueue('heartbeat', { now: new Date().toISOString() });
            }, HEARTBEAT_INTERVAL_MS);

            fsSync.watchFile(logPath, { interval: 500 }, async (current) => {
                if (closed) {
                    return;
                }
                if (current.size <= offset) {
                    offset = current.size;
                    return;
                }

                const chunk = await readLogChunk(logPath, offset, current.size);
                offset = current.size;
                const lines = chunk.split(/\r?\n/u).filter((line) => line.length > 0);
                if (lines.length > 0) {
                    enqueue('append', { lines });
                }
            });
        },
        cancel: close
    });

    return new Response(stream, {
        headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive'
        }
    });
};

async function readFileSize(filePath: string): Promise<number> {
    try {
        return (await fs.stat(filePath)).size;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return 0;
        }
        throw error;
    }
}

async function readLogChunk(filePath: string, start: number, end: number): Promise<string> {
    const handle = await fs.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(end - start);
        const result = await handle.read(buffer, 0, buffer.length, start);
        return buffer.subarray(0, result.bytesRead).toString('utf8');
    } finally {
        await handle.close();
    }
}
