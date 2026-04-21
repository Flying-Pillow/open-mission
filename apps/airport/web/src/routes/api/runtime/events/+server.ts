// /apps/airport/web/src/routes/api/runtime/events/+server.ts: Server-sent event stream that forwards existing daemon notifications for Airport web.
import { randomUUID } from 'node:crypto';
import { airportRuntimeEventsQuerySchema } from '@flying-pillow/mission-core';
import { AirportWebGateway } from '$lib/server/gateway/AirportWebGateway.server';
import type { RequestHandler } from './$types';

function serializeSseEvent(input: {
    event: string;
    data: string;
    id?: string;
}): string {
    const lines = [
        ...(input.id ? [`id: ${input.id}`] : []),
        `event: ${input.event}`,
        ...input.data.split('\n').map((line) => `data: ${line}`),
        ''
    ];
    return `${lines.join('\n')}\n`;
}

export const GET: RequestHandler = async ({ locals, request, url }) => {
    const query = airportRuntimeEventsQuerySchema.parse({
        missionId: url.searchParams.get('missionId') ?? undefined
    });
    const repositoryRootPath = url.searchParams.get('repositoryRootPath')?.trim() || undefined;
    const gateway = new AirportWebGateway(locals);
    const encoder = new TextEncoder();

    let disposeSubscription: (() => void) | undefined;
    let disposeHeartbeat: (() => void) | undefined;
    let closed = false;

    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        disposeHeartbeat?.();
        disposeSubscription?.();
    };

    const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
            request.signal.addEventListener('abort', () => {
                close();
                try {
                    controller.close();
                } catch {
                    // Ignore duplicate close attempts during request abort.
                }
            }, { once: true });

            controller.enqueue(encoder.encode(serializeSseEvent({
                event: 'connected',
                id: randomUUID(),
                data: JSON.stringify({ connected: true })
            })));

            const heartbeat = setInterval(() => {
                if (closed) {
                    return;
                }
                controller.enqueue(encoder.encode(serializeSseEvent({
                    event: 'heartbeat',
                    id: randomUUID(),
                    data: JSON.stringify({ ok: true })
                })));
            }, 15_000);
            disposeHeartbeat = () => clearInterval(heartbeat);

            const subscription = await gateway.openEventSubscription({
                missionId: query.missionId,
                ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {}),
                onEvent: (event) => {
                    if (closed) {
                        return;
                    }
                    controller.enqueue(encoder.encode(serializeSseEvent({
                        event: 'runtime',
                        id: event.eventId,
                        data: JSON.stringify(event)
                    })));
                }
            });
            disposeSubscription = () => subscription.dispose();
        },
        cancel: () => {
            close();
        }
    });

    return new Response(stream, {
        headers: {
            'cache-control': 'no-store',
            connection: 'keep-alive',
            'content-type': 'text/event-stream'
        }
    });
};