import { z } from 'zod/v4';

export type SurrealDatabaseScope = 'global' | 'tenant';
export type SurrealDatabaseKey = 'global' | 'tenant';
export type SurrealTableKind = 'normal' | 'relation';
export type SurrealOnDeletePolicy = 'unset' | 'cascade' | 'reject' | 'ignore';
export type SurrealIndexKind = 'normal' | 'unique';
export type SurrealVectorIndexDistance = 'COSINE' | 'EUCLIDEAN' | 'MANHATTAN';
export type SurrealVectorIndexType = 'F32' | 'F64';

export type SurrealAnalyzerMetadata = {
    name: string;
    tokenizers: string[];
    filters: string[];
};

export type SurrealFullTextIndexMetadata = {
    analyzer: string;
    bm25?: boolean | string;
    highlights?: boolean;
};

export type SurrealTableIndexMetadata = {
    name: string;
    fields: string[];
    unique?: boolean;
    fulltext?: SurrealFullTextIndexMetadata;
};

export type SurrealVectorIndexMetadata = {
    kind: 'hnsw';
    dimension?: number;
    distance?: SurrealVectorIndexDistance;
    vectorType?: SurrealVectorIndexType;
    concurrently?: boolean;
};

export type SurrealIndexMetadata = SurrealIndexKind | SurrealVectorIndexMetadata | false;

export type SurrealTableMetadata = {
    table: string;
    description?: string;
    kind?: SurrealTableKind;
    from?: string;
    to?: string;
    scope?: SurrealDatabaseScope;
    databaseKey?: SurrealDatabaseKey;
    schemafull?: boolean;
    omitSchemaMode?: boolean;
    as?: string;
    permissions?: string;
    analyzers?: SurrealAnalyzerMetadata[];
    indexes?: SurrealTableIndexMetadata[];
};

export type SurrealFieldMetadata = {
    name?: string;
    description?: string;
    compute?: string;
    value?: string;
    reference?: string;
    type?: string;
    array?: boolean;
    optional?: boolean;
    nullable?: boolean;
    flexible?: boolean;
    onDelete?: SurrealOnDeletePolicy;
    index?: SurrealIndexMetadata;
    sortIndex?: boolean;
    searchable?: boolean;
    sensitive?: boolean;
    storage?: boolean;
    assertion?: string;
    default?: string;
    readonly?: boolean;
    fields?: Record<string, SurrealFieldMetadata>;
};

export const table = z.registry<SurrealTableMetadata>();
export const field = z.registry<SurrealFieldMetadata>();

export function getTableMetadata(schema: unknown): SurrealTableMetadata | undefined {
    const metadata = table.get(schema as never);
    return metadata ? normalizeTableMetadata(metadata) : undefined;
}

export function getFieldMetadata(schema: unknown): SurrealFieldMetadata | undefined {
    const metadata = field.get(schema as never);
    return metadata ? normalizeFieldMetadata(metadata) : undefined;
}

function normalizeTableMetadata(metadata: SurrealTableMetadata): SurrealTableMetadata {
    const tableName = metadata.table.trim();
    if (!tableName) {
        throw new Error('Surreal table metadata requires a table name.');
    }

    return {
        table: tableName,
        ...(metadata.kind ? { kind: metadata.kind } : {}),
        ...(metadata.from?.trim() ? { from: metadata.from.trim() } : {}),
        ...(metadata.to?.trim() ? { to: metadata.to.trim() } : {}),
        ...(metadata.scope ? { scope: metadata.scope } : {}),
        ...(metadata.databaseKey ? { databaseKey: metadata.databaseKey } : {}),
        ...(metadata.schemafull !== undefined ? { schemafull: metadata.schemafull } : {}),
        ...(metadata.omitSchemaMode !== undefined ? { omitSchemaMode: metadata.omitSchemaMode } : {}),
        ...(metadata.as?.trim() ? { as: metadata.as.trim() } : {}),
        ...(metadata.permissions?.trim() ? { permissions: metadata.permissions.trim() } : {}),
        ...(metadata.analyzers ? { analyzers: metadata.analyzers.map(normalizeAnalyzerMetadata) } : {}),
        ...(metadata.indexes ? { indexes: metadata.indexes.map(normalizeTableIndexMetadata) } : {}),
        ...(metadata.description?.trim() ? { description: metadata.description.trim() } : {})
    };
}

function normalizeFieldMetadata(metadata: SurrealFieldMetadata): SurrealFieldMetadata {
    return {
        ...(metadata.name?.trim() ? { name: metadata.name.trim() } : {}),
        ...(metadata.description?.trim() ? { description: metadata.description.trim() } : {}),
        ...(metadata.compute?.trim() ? { compute: metadata.compute.trim() } : {}),
        ...(metadata.value?.trim() ? { value: metadata.value.trim() } : {}),
        ...(metadata.reference?.trim() ? { reference: metadata.reference.trim() } : {}),
        ...(metadata.type?.trim() ? { type: metadata.type.trim() } : {}),
        ...(metadata.array !== undefined ? { array: metadata.array } : {}),
        ...(metadata.optional !== undefined ? { optional: metadata.optional } : {}),
        ...(metadata.nullable !== undefined ? { nullable: metadata.nullable } : {}),
        ...(metadata.flexible !== undefined ? { flexible: metadata.flexible } : {}),
        ...(metadata.onDelete ? { onDelete: metadata.onDelete } : {}),
        ...(metadata.index !== undefined ? { index: normalizeIndexMetadata(metadata.index) } : {}),
        ...(metadata.sortIndex !== undefined ? { sortIndex: metadata.sortIndex } : {}),
        ...(metadata.searchable !== undefined ? { searchable: metadata.searchable } : {}),
        ...(metadata.sensitive !== undefined ? { sensitive: metadata.sensitive } : {}),
        ...(metadata.storage !== undefined ? { storage: metadata.storage } : {}),
        ...(metadata.assertion?.trim() ? { assertion: metadata.assertion.trim() } : {}),
        ...(metadata.default?.trim() ? { default: metadata.default.trim() } : {}),
        ...(metadata.readonly !== undefined ? { readonly: metadata.readonly } : {}),
        ...(metadata.fields ? { fields: normalizeFieldMetadataRecord(metadata.fields) } : {})
    };
}

function normalizeFieldMetadataRecord(fields: Record<string, SurrealFieldMetadata>): Record<string, SurrealFieldMetadata> {
    const normalizedFields: Array<[string, SurrealFieldMetadata]> = Object.entries(fields)
        .map(([fallbackName, metadata]) => {
            const normalized = normalizeFieldMetadata(metadata);
            return [normalized.name ?? fallbackName, normalized] satisfies [string, SurrealFieldMetadata];
        })
        .filter(([name]) => name.trim().length > 0)
        .sort(([leftName], [rightName]) => leftName.localeCompare(rightName));

    return Object.fromEntries(normalizedFields);
}

function normalizeAnalyzerMetadata(metadata: SurrealAnalyzerMetadata): SurrealAnalyzerMetadata {
    const name = metadata.name.trim();
    if (!name) {
        throw new Error('Surreal analyzer metadata requires a name.');
    }

    return {
        name,
        tokenizers: metadata.tokenizers.map((tokenizer) => tokenizer.trim()).filter(Boolean),
        filters: metadata.filters.map((filter) => filter.trim()).filter(Boolean)
    };
}

function normalizeTableIndexMetadata(metadata: SurrealTableIndexMetadata): SurrealTableIndexMetadata {
    const name = metadata.name.trim();
    if (!name) {
        throw new Error('Surreal index metadata requires a name.');
    }

    return {
        name,
        fields: metadata.fields.map((indexedField) => indexedField.trim()).filter(Boolean),
        ...(metadata.unique !== undefined ? { unique: metadata.unique } : {}),
        ...(metadata.fulltext ? { fulltext: normalizeFullTextIndexMetadata(metadata.fulltext) } : {})
    };
}

function normalizeFullTextIndexMetadata(metadata: SurrealFullTextIndexMetadata): SurrealFullTextIndexMetadata {
    const analyzer = metadata.analyzer.trim();
    if (!analyzer) {
        throw new Error('Surreal fulltext index metadata requires an analyzer name.');
    }

    return {
        analyzer,
        ...(metadata.bm25 !== undefined ? { bm25: metadata.bm25 } : {}),
        ...(metadata.highlights !== undefined ? { highlights: metadata.highlights } : {})
    };
}

function normalizeIndexMetadata(index: SurrealIndexMetadata): SurrealIndexMetadata {
    if (!index || typeof index === 'string') {
        return index;
    }

    return {
        kind: 'hnsw',
        ...(index.dimension !== undefined ? { dimension: index.dimension } : {}),
        distance: index.distance ?? 'COSINE',
        vectorType: index.vectorType ?? 'F32',
        concurrently: index.concurrently ?? true
    };
}