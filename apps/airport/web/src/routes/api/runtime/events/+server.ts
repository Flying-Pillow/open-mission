// /apps/airport/web/src/routes/api/runtime/events/+server.ts: Server-sent event stream that forwards existing daemon notifications for Airport web.
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';
import type { RequestHandler } from './$types';

const DAEMON_STREAM_RECONNECT_DELAY_MS = 1_000;

const airportRuntimeEventsQuerySchema = z.object({
    missionId: z.string().trim().min(1).optional(),
    scope: z.enum(['mission', 'application']).optional()
}).strict();

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
        missionId: url.searchParams.get('missionId') ?? undefined,
        scope: url.searchParams.get('scope') ?? undefined
    });
    const repositoryRootPath = url.searchParams.get('repositoryRootPath')?.trim() || undefined;
    const gateway = new DaemonGateway(locals);
    const encoder = new TextEncoder();
    let successfulSubscriptionCount = 0;

    let disposeSubscription: (() => void) | undefined;
    let disposeHeartbeat: (() => void) | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = undefined;
        }
        disposeHeartbeat?.();
        disposeSubscription?.();
        disposeSubscription = undefined;
    };

    const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
            const emitConnected = () => {
                successfulSubscriptionCount += 1;
                controller.enqueue(encoder.encode(serializeSseEvent({
                    event: 'connected',
                    id: randomUUID(),
                    data: JSON.stringify({
                        connected: true,
                        recovered: successfulSubscriptionCount > 1
                    })
                })));
            };

            const scheduleReconnect = () => {
                if (closed || reconnectTimer) {
                    return;
                }

                reconnectTimer = setTimeout(() => {
                    reconnectTimer = undefined;
                    void connectSubscription();
                }, DAEMON_STREAM_RECONNECT_DELAY_MS);
            };

            const connectSubscription = async () => {
                if (closed) {
                    return;
                }

                try {
                    if (query.scope === 'application') {
                        const pendingEvents: unknown[] = [];
                        let subscriptionConnected = false;
                        const emitEvent = (event: unknown) => {
                            controller.enqueue(encoder.encode(serializeSseEvent({
                                event: 'entity',
                                id: randomUUID(),
                                data: JSON.stringify(event)
                            })));
                        };
                        const applicationSubscription = await gateway.openApplicationEventSubscription({
                            channels: ['repository:*.*', 'agent_execution:*.*'],
                            ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {}),
                            onDisconnect: () => {
                                if (closed || disposeSubscription !== activeDispose) {
                                    return;
                                }
                                disposeSubscription = undefined;
                                scheduleReconnect();
                            },
                            onEvent: (event) => {
                                if (closed) {
                                    return;
                                }
                                if (!subscriptionConnected) {
                                    pendingEvents.push(event);
                                    return;
                                }
                                emitEvent(event);
                            }
                        });

                        const activeDispose = () => applicationSubscription.dispose();
                        if (closed) {
                            activeDispose();
                            return;
                        }
                        disposeSubscription?.();
                        disposeSubscription = activeDispose;
                        emitConnected();
                        subscriptionConnected = true;
                        for (const event of pendingEvents) {
                            if (closed) {
                                break;
                            }
                            emitEvent(event);
                        }
                        return;
                    }

                    const pendingEvents: unknown[] = [];
                    let subscriptionConnected = false;
                    const emitEvent = (event: { eventId: string }) => {
                        controller.enqueue(encoder.encode(serializeSseEvent({
                            event: 'runtime',
                            id: event.eventId,
                            data: JSON.stringify(event)
                        })));
                    };
                    const subscription = await gateway.openEventSubscription({
                        missionId: query.missionId,
                        ...(repositoryRootPath ? { surfacePath: repositoryRootPath } : {}),
                        onDisconnect: () => {
                            if (closed || disposeSubscription !== activeDispose) {
                                return;
                            }
                            disposeSubscription = undefined;
                            scheduleReconnect();
                        },
                        onEvent: (event) => {
                            if (closed) {
                                return;
                            }
                            if (!subscriptionConnected) {
                                pendingEvents.push(event);
                                return;
                            }
                            emitEvent(event);
                        }
                    });

                    const activeDispose = () => subscription.dispose();
                    if (closed) {
                        activeDispose();
                        return;
                    }
                    disposeSubscription?.();
                    disposeSubscription = activeDispose;
                    emitConnected();
                    subscriptionConnected = true;
                    for (const event of pendingEvents) {
                        if (closed) {
                            break;
                        }
                        emitEvent(event as { eventId: string });
                    }
                } catch {
                    scheduleReconnect();
                }
            };

            request.signal.addEventListener('abort', () => {
                close();
                try {
                    controller.close();
                } catch {
                    // Ignore duplicate close attempts during request abort.
                }
            }, { once: true });

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

            await connectSubscription();
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