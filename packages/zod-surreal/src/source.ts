import type { z } from 'zod/v4';
import { compileModel, defineModel, type CompiledSurrealModel, type ZodSurrealModelDefinition } from './model.js';

export type SchemaSourceModel = ZodSurrealModelDefinition;

export interface SchemaSource {
    listModels(): SchemaSourceModel[];
}

export interface InMemorySchemaSourceContract extends SchemaSource {
    sourceKind: 'in-memory';
}

export type InMemorySchemaSourceOptions = {
    sort?: boolean;
};

export class InMemorySchemaSource implements InMemorySchemaSourceContract {
    public readonly sourceKind = 'in-memory' as const;
    readonly #models: SchemaSourceModel[];

    constructor(models: SchemaSourceModel[], options: InMemorySchemaSourceOptions = {}) {
        this.#models = normalizeModels(models, options);
    }

    listModels(): SchemaSourceModel[] {
        return this.#models.map(cloneModel);
    }

    compileModels(): CompiledSurrealModel[] {
        return this.listModels().map(compileModel);
    }
}

export function model(definition: {
    name: string;
    schema: z.ZodObject;
    inputSchema?: z.ZodObject;
    storageSchema?: z.ZodObject;
    dataSchema?: z.ZodObject;
}): SchemaSourceModel {
    return defineModel(definition);
}

function normalizeModels(models: SchemaSourceModel[], options: InMemorySchemaSourceOptions): SchemaSourceModel[] {
    const copied = models.map((sourceModel) => defineModel(sourceModel));
    if (options.sort === false) {
        return copied;
    }

    return copied.sort((left, right) => left.name.localeCompare(right.name));
}

function cloneModel(sourceModel: SchemaSourceModel): SchemaSourceModel {
    return defineModel(sourceModel);
}