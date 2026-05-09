export class AgentExecutionObservationLedger {
    private readonly observedIds = new Set<string>();

    public has(observationId: string): boolean {
        return this.observedIds.has(observationId);
    }

    public record(observationId: string): void {
        this.observedIds.add(observationId);
    }
}
