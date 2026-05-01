import type { EntityModel } from './EntityModel.svelte.js';

export abstract class Entity<TData, TId extends string = string>
	implements EntityModel<TData, TId> {
	public abstract get id(): TId;
	public abstract updateFromData(data: TData): this;
	public abstract toData(): TData;

	public toJSON(): TData {
		return this.toData();
	}
}