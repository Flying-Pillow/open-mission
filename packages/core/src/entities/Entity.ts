export type EntityStateSnapshot<TSnapshot extends object, TCommandSnapshot extends object> = {
	data: TSnapshot;
	commands?: TCommandSnapshot;
};

export abstract class Entity<
	TSnapshot extends object,
	TId extends string = string,
	TCommandSnapshot extends object = never
> {
	private snapshotState: TSnapshot;
	private commandState: TCommandSnapshot | undefined;

	protected constructor(snapshot: TSnapshot) {
		this.snapshotState = structuredClone(snapshot);
	}

	public abstract get id(): TId;

	protected get data(): TSnapshot {
		return this.snapshotState;
	}

	protected set data(snapshot: TSnapshot) {
		this.snapshotState = structuredClone(snapshot);
	}

	public updateFromSnapshot(snapshot: TSnapshot): this {
		this.data = snapshot;
		return this;
	}

	public toSnapshot(): TSnapshot {
		return structuredClone(this.data);
	}

	protected get commands(): TCommandSnapshot | undefined {
		return this.commandState
			? structuredClone(this.commandState)
			: undefined;
	}

	protected set commands(snapshot: TCommandSnapshot | undefined) {
		this.commandState = snapshot
			? structuredClone(snapshot)
			: undefined;
	}

	public toStateSnapshot(): EntityStateSnapshot<TSnapshot, TCommandSnapshot> {
		return {
			data: this.toSnapshot(),
			...(this.commands ? { commands: this.commands } : {})
		};
	}

	public toJSON(): TSnapshot {
		return this.toSnapshot();
	}
}