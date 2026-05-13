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

type InferredSurrealFieldShape = {
    type?: string;
    array?: boolean;
    optional?: boolean;
    nullable?: boolean;
};

type ZodRuntimeDefinition = {
    type?: string;
    innerType?: z.ZodType;
    element?: z.ZodType;
    checks?: Array<{
        isInt?: boolean;
        format?: string;
        def?: {
            check?: string;
            format?: string;
        };
    }>;
    values?: unknown[];
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
    return normalizeCompiledField(name, metadata, storage, inferSurrealFieldShape(fieldSchema), compileNestedFields(fieldSchema, metadata));
}

function compileNestedFields(
    fieldSchema: z.ZodType,
    metadata: SurrealFieldMetadata
): Record<string, CompiledSurrealField> | undefined {
    if (metadata.fields) {
        return Object.fromEntries(
            Object.entries(metadata.fields)
                .map(([fallbackName, nestedMetadata]) => {
                    const name = nestedMetadata.name ?? fallbackName;
                    return normalizeCompiledField(name, nestedMetadata, nestedMetadata.storage ?? false);
                })
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((field) => [field.name, field])
        );
    }

    if (fieldSchema instanceof z.ZodObject) {
        return compileFields(fieldSchema, fieldSchema);
    }

    return undefined;
}

function normalizeCompiledField(
    name: string,
    metadata: SurrealFieldMetadata,
    storage: boolean,
    inferred: InferredSurrealFieldShape = {},
    fields?: Record<string, CompiledSurrealField>
): CompiledSurrealField {
    return {
        name,
        ...(metadata.description ? { description: metadata.description } : {}),
        ...(metadata.compute ? { compute: metadata.compute } : {}),
        ...(metadata.value ? { value: metadata.value } : {}),
        ...(metadata.reference ? { reference: metadata.reference } : {}),
        ...(metadata.type ?? inferred.type ? { type: metadata.type ?? inferred.type } : {}),
        array: metadata.array ?? inferred.array ?? false,
        optional: metadata.optional ?? inferred.optional ?? false,
        nullable: metadata.nullable ?? inferred.nullable ?? false,
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
        ...(metadata.comment ? { comment: metadata.comment } : {}),
        ...(fields && Object.keys(fields).length > 0 ? { fields } : {})
    };
}

function inferSurrealFieldShape(schema: z.ZodType): InferredSurrealFieldShape {
    const definition = readZodDefinition(schema);

    switch (definition.type) {
        case 'optional': {
            return mergeInferredSurrealFieldShape(inferInnerSurrealFieldShape(definition), { optional: true });
        }
        case 'nullable': {
            return mergeInferredSurrealFieldShape(inferInnerSurrealFieldShape(definition), { nullable: true });
        }
        case 'default':
        case 'catch':
        case 'readonly':
        case 'nonoptional': {
            return inferInnerSurrealFieldShape(definition);
        }
        case 'array': {
            return mergeInferredSurrealFieldShape(inferElementSurrealFieldShape(definition), { array: true });
        }
        case 'string':
        case 'enum': {
            return { type: 'string' };
        }
        case 'literal': {
            return inferLiteralSurrealFieldShape(definition.values ?? []);
        }
        case 'number': {
            return { type: isIntNumberDefinition(definition) ? 'int' : 'number' };
        }
        case 'boolean': {
            return { type: 'bool' };
        }
        case 'bigint': {
            return { type: 'int' };
        }
        case 'date': {
            return { type: 'datetime' };
        }
        case 'object':
        case 'record':
        case 'map': {
            return { type: 'object' };
        }
        default: {
            return {};
        }
    }
}

function inferInnerSurrealFieldShape(definition: ZodRuntimeDefinition): InferredSurrealFieldShape {
    return definition.innerType ? inferSurrealFieldShape(definition.innerType) : {};
}

function inferElementSurrealFieldShape(definition: ZodRuntimeDefinition): InferredSurrealFieldShape {
    return definition.element ? inferSurrealFieldShape(definition.element) : {};
}

function mergeInferredSurrealFieldShape(
    inferred: InferredSurrealFieldShape,
    override: InferredSurrealFieldShape
): InferredSurrealFieldShape {
    return {
        ...inferred,
        ...override
    };
}

function inferLiteralSurrealFieldShape(values: unknown[]): InferredSurrealFieldShape {
    const valueTypes = new Set(values.map((value) => typeof value));
    if (valueTypes.size !== 1) {
        return {};
    }

    switch ([...valueTypes][0]) {
        case 'string': {
            return { type: 'string' };
        }
        case 'number': {
            return { type: 'number' };
        }
        case 'boolean': {
            return { type: 'bool' };
        }
        case 'bigint': {
            return { type: 'int' };
        }
        default: {
            return {};
        }
    }
}

function isIntNumberDefinition(definition: ZodRuntimeDefinition): boolean {
    return Boolean(definition.checks?.some((check) =>
        check.isInt === true || check.format === 'safeint' || check.def?.format === 'safeint' || check.def?.check === 'int'
    ));
}

function readZodDefinition(schema: z.ZodType): ZodRuntimeDefinition {
    return (schema as z.ZodType & { _def?: ZodRuntimeDefinition })._def ?? {};
}
