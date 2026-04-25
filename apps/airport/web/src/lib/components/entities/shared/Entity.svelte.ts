import type { EntityModel } from './EntityModel.svelte.js';

export abstract class Entity<TSnapshot, TId extends string = string>
	implements EntityModel<TSnapshot, TId> {
	public abstract get id(): TId;
	public abstract updateFromSnapshot(snapshot: TSnapshot): this;
	public abstract toSnapshot(): TSnapshot;

	public toJSON(): TSnapshot {
		return this.toSnapshot();
	}
}