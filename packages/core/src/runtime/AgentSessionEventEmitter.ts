export interface AgentDisposable {
    dispose(): void;
}

export class AgentSessionEventEmitter<T> implements AgentDisposable {
    private readonly listeners = new Set<(event: T) => void>();

    public readonly event = (listener: (event: T) => void): AgentDisposable => {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            }
        };
    };

    public fire(event: T): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    public dispose(): void {
        this.listeners.clear();
    }
}
