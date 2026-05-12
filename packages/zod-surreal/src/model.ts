import { z } from 'zod/v4';
import {
    getFieldMetadata,
    getTableMetadata,
    type SurrealDatabaseKey,
    type SurrealDatabaseScope,
    type SurrealAnalyzerMetadata,
    type SurrealFieldMetadata,
    type SurrealIndexMetadata,
    type SurrealOnDeletePolicy,
    type SurrealTableIndexMetadata,
    type SurrealTableKind
} from './metadata.js';

export type ZodSurrealModelDefinition = {
    name: string;
    schema: z.ZodObject;
    inputSchema?: z.ZodObject;
    storageSchema?: z.ZodObject;
    dataSchema?: z.ZodObject;
    relationships?: CompiledSurrealRelationship[];
};

export type CompiledSurrealField = {
    name: string;
    description?: string;
    compute?: string;
    value?: string;
    reference?: string;
    type?: string;
    array: boolean;
    optional: boolean;
    nullable: boolean;
    flexible: boolean;
    onDelete?: SurrealOnDeletePolicy;
    index: SurrealIndexMetadata;
    sortIndex: boolean;
    searchable: boolean;
    sensitive: boolean;
    storage: boolean;
    assertion?: string;
    default?: string;
    readonly: boolean;
    comment?: string;
    fields?: Record<string, CompiledSurrealField>;
};

export type CompiledSurrealRelationship = {
    name: string;
    type: 'direct' | 'edge_from' | 'edge_to';
    target: string;
    localField: string;
    cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one';
    description?: string;
};

export type CompiledSurrealModel = {
    name: string;
    scope: SurrealDatabaseScope;
    databaseKey: SurrealDatabaseKey;
    table: string;
    kind: SurrealTableKind;
    schemafull: boolean;
    omitSchemaMode: boolean;
    from?: string;
    to?: string;
    as?: string;
    permissions?: string;
    comment?: string;
    inputSchemaName: string;
    storageSchemaName: string;
    dataSchemaName: string;
    fields: Record<string, CompiledSurrealField>;
    analyzers: SurrealAnalyzerMetadata[];
    indexes: SurrealTableIndexMetadata[];
    relationships: CompiledSurrealRelationship[];
};

export type CompiledSurrealSchemaSnapshot = {
    artifactVersion: '1';
    generatedAt?: string;
    models: Record<string, CompiledSurrealModel>;
};

export type CompileSchemaOptions = {
    generatedAt?: string;
};

export function defineModel(definition: ZodSurrealModelDefinition): ZodSurrealModelDefinition {
    const modelName = definition.name.trim();
    if (!modelName) {
        throw new Error('Zod Surreal model definition requires a name.');
    }

    return {
        name: modelName,
        schema: definition.schema,
        ...(definition.inputSchema ? { inputSchema: definition.inputSchema } : {}),
        ...(definition.storageSchema ? { storageSchema: definition.storageSchema } : {}),
        ...(definition.dataSchema ? { dataSchema: definition.dataSchema } : {}),
        ...(definition.relationships ? { relationships: [...definition.relationships] } : {})
    };
}

export function compileSchema(
    input: { models: ZodSurrealModelDefinition[] },
    options: CompileSchemaOptions = {}
): CompiledSurrealSchemaSnapshot {
    const models = Object.fromEntries(
        input.models
            .map(compileModel)
            .sort((left, right) => {
                if (left.name !== right.name) {
                    return left.name.localeCompare(right.name);
                }
                return left.table.localeCompare(right.table);
            })
            .map((model) => [model.name, model])
    );

    return {
        artifactVersion: '1',
        ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
        models
    };
}

export function compileModel(definition: ZodSurrealModelDefinition): CompiledSurrealModel {
    const table = getTableMetadata(definition.schema);
    if (!table) {
        throw new Error(`Model '${definition.name}' schema is missing Surreal table metadata.`);
    }

    const storageSchema = definition.storageSchema ?? definition.schema;
    const dataSchema = definition.dataSchema ?? definition.schema;

    return {
        name: definition.name,
        scope: table.scope ?? 'tenant',
        databaseKey: table.databaseKey ?? table.scope ?? 'tenant',
        table: table.table,
        kind: table.kind ?? 'normal',
        schemafull: table.schemafull ?? true,
        omitSchemaMode: table.omitSchemaMode ?? false,
        ...(table.from ? { from: table.from } : {}),
        ...(table.to ? { to: table.to } : {}),
        ...(table.as ? { as: table.as } : {}),
        ...(table.permissions ? { permissions: table.permissions } : {}),
        ...(table.comment ? { comment: table.comment } : {}),
        inputSchemaName: `${definition.name}Input`,
        storageSchemaName: `${definition.name}Storage`,
        dataSchemaName: `${definition.name}Data`,
        fields: compileFields(dataSchema, storageSchema),
        analyzers: table.analyzers ? [...table.analyzers] : [],
        indexes: table.indexes ? [...table.indexes] : [],
        relationships: definition.relationships ? [...definition.relationships] : []
    };
}

function compileFields(dataSchema: z.ZodObject, storageSchema: z.ZodObject): Record<string, CompiledSurrealField> {
    const storageFieldNames = new Set(Object.keys(storageSchema.shape));
    return Object.fromEntries(
        Object.entries(dataSchema.shape)
            .map(([fallbackName, fieldSchema]) => compileField(fallbackName, fieldSchema, storageFieldNames))
            .filter((field): field is CompiledSurrealField => Boolean(field))
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((field) => [field.name, field])
    );
}

function compileField(
    fallbackName: string,
    fieldSchema: z.ZodType,
    storageFieldNames: Set<string>
): CompiledSurrealField | undefined {
    const metadata = getFieldMetadata(fieldSchema);
    if (!metadata) {
        return undefined;
    }

    const name = metadata.name ?? fallbackName;
    const storage = metadata.storage ?? (storageFieldNames.has(fallbackName) || storageFieldNames.has(name));
    return normalizeCompiledField(name, metadata, storage);
}

function normalizeCompiledField(
    name: string,
    metadata: SurrealFieldMetadata,
    storage: boolean
): CompiledSurrealField {
    return {
        name,
        ...(metadata.description ? { description: metadata.description } : {}),
        ...(metadata.compute ? { compute: metadata.compute } : {}),
        ...(metadata.value ? { value: metadata.value } : {}),
        ...(metadata.reference ? { reference: metadata.reference } : {}),
        ...(metadata.type ? { type: metadata.type } : {}),
        array: metadata.array ?? false,
        optional: metadata.optional ?? false,
        nullable: metadata.nullable ?? false,
        flexible: metadata.flexible ?? false,
        ...(metadata.onDelete ? { onDelete: metadata.onDelete } : {}),
        index: metadata.index ?? false,
        sortIndex: metadata.sortIndex ?? false,
        searchable: metadata.searchable ?? false,
        sensitive: metadata.sensitive ?? false,
        storage,
        ...(metadata.assertion ? { assertion: metadata.assertion } : {}),
        ...(metadata.default ? { default: metadata.default } : {}),
        readonly: metadata.readonly ?? false,
        ...(metadata.comment ? { comment: metadata.comment } : {})
    };
}