// /apps/airport/web/src/lib/client/runtime/transport/EntityRuntimeTransport.ts: Entity-agnostic transport for runtime snapshot reads and event streams.
type EventSourceFactory = (url: string) => EventSource;

export type RuntimeSubscription = {
    dispose(): void;
};

export abstract class EntityRuntimeTransport<TId extends string, TSnapshot, TEvent> {
    private readonly fetcher: typeof fetch;
    private readonly createEventSource: EventSourceFactory;

    public constructor(input: {
        fetch?: typeof fetch;
        createEventSource?: EventSourceFactory;
    } = {}) {
        this.fetcher = input.fetch ?? fetch;
        this.createEventSource = input.createEventSource ?? ((url) => new EventSource(url));
    }

    public async getSnapshot(id: TId): Promise<TSnapshot> {
        const normalizedId = this.normalizeEntityId(id);
        const response = await this.fetcher(this.buildSnapshotUrl(normalizedId), {
            headers: {
                accept: 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(this.describeSnapshotFetchFailure(normalizedId, response.status));
        }

        return this.parseSnapshot(await response.json());
    }

    public observe(input: {
        id: TId;
        onEvent?: (event: TEvent) => void | Promise<void>;
        onError?: (error: Error) => void;
    }): RuntimeSubscription {
        const normalizedId = this.normalizeEntityId(input.id);
        const eventSource = this.createEventSource(this.buildEventsUrl(normalizedId));

        const handleRuntimeEvent = (event: Event) => {
            const messageEvent = event as MessageEvent<string>;
            void (async () => {
                try {
                    const payload = JSON.parse(messageEvent.data);
                    const runtimeEvent = this.parseEvent(payload);
                    await input.onEvent?.(runtimeEvent);
                } catch (error) {
                    input.onError?.(error instanceof Error ? error : new Error(String(error)));
                }
            })();
        };

        const handleError = () => {
            input.onError?.(new Error(this.describeEventStreamFailure(normalizedId)));
        };

        eventSource.addEventListener('runtime', handleRuntimeEvent as EventListener);
        eventSource.addEventListener('error', handleError as EventListener);

        return {
            dispose: () => {
                eventSource.removeEventListener('runtime', handleRuntimeEvent as EventListener);
                eventSource.removeEventListener('error', handleError as EventListener);
                eventSource.close();
            }
        };
    }

    protected abstract buildSnapshotUrl(id: TId): string;
    protected abstract buildEventsUrl(id: TId): string;
    protected abstract parseSnapshot(value: unknown): TSnapshot;
    protected abstract parseEvent(value: unknown): TEvent;
    protected abstract getEntityLabel(): string;

    private normalizeEntityId(id: TId): TId {
        const normalizedId = id.trim() as TId;
        if (!normalizedId) {
            throw new Error(`${this.getEntityLabel()} runtime operation requires a non-empty id.`);
        }

        return normalizedId;
    }

    private describeSnapshotFetchFailure(id: TId, status: number): string {
        return `${this.getEntityLabel()} runtime snapshot fetch failed for '${id}' (${status}).`;
    }

    private describeEventStreamFailure(id: TId): string {
        return `${this.getEntityLabel()} runtime event stream failed for '${id}'.`;
    }
}