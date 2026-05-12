import type { CompiledSurrealField, CompiledSurrealModel, CompiledSurrealSchemaSnapshot } from './model.js';

export type TableSchemaState = {
    fields: Set<string>;
    indexes: Set<string>;
};

export type DdlPlan = {
    scope?: 'global' | 'tenant';
    tables: string[];
    statements: string[];
};

export type CompileDdlPlanInput = {
    snapshot: CompiledSurrealSchemaSnapshot;
    scope?: 'global' | 'tenant';
    prune?: boolean;
    currentState?: Map<string, TableSchemaState>;
    overwrite?: boolean;
};

export function compileDefineStatements(snapshot: CompiledSurrealSchemaSnapshot): string[] {
    return compileDdlPlan({ snapshot }).statements;
}

export function compileDdlPlan(input: CompileDdlPlanInput): DdlPlan {
    const models = Object.values(input.snapshot.models).filter((model) => !input.scope || model.scope === input.scope);
    const statements = models.flatMap((model) => [
        compileDefineTableStatement(model),
        ...Object.values(model.fields).flatMap((field) => compileDefineFieldAndIndexStatements(model, field, models)),
        ...model.analyzers.map(compileDefineAnalyzerStatement),
        ...model.indexes.map((index) => compileDefineTableIndexStatement(model, index))
    ]);

    if (input.prune && input.currentState) {
        statements.push(...compilePruneStatements(models, input.currentState));
    }

    return {
        ...(input.scope ? { scope: input.scope } : {}),
        tables: models.map((model) => model.table),
        statements
    };
}

export function compileDefineTableStatement(model: CompiledSurrealModel): string {
    const clauses = [
        'DEFINE TABLE',
        surrealIdentifier(model.table),
        'TYPE',
        model.kind === 'relation' ? 'RELATION' : 'NORMAL',
        ...(model.kind === 'relation' && model.from && model.to
            ? ['FROM', surrealIdentifier(model.from), 'TO', surrealIdentifier(model.to)]
            : []),
        ...(model.omitSchemaMode ? [] : [model.schemafull ? 'SCHEMAFULL' : 'SCHEMALESS']),
        ...(model.as ? ['AS', model.as] : []),
        ...(model.permissions ? ['PERMISSIONS', model.permissions] : []),
        ...(model.comment ? [`COMMENT ${surrealString(model.comment)}`] : [])
    ];
    return `${clauses.join(' ')};`;
}

export function compileDefineFieldStatement(model: CompiledSurrealModel, field: CompiledSurrealField): string {
    const fieldType = compileFieldType(model, field, []);
    const clauses = [
        'DEFINE FIELD',
        surrealFieldPath(field.name),
        'ON TABLE',
        surrealIdentifier(model.table),
        ...(field.compute ? ['COMPUTED', field.compute] : []),
        ...(!field.compute && fieldType ? ['TYPE', fieldType] : []),
        ...(field.value ? ['VALUE', field.value] : []),
        ...(field.flexible ? ['FLEXIBLE'] : []),
        ...(field.reference ? ['REFERENCE', ...(field.onDelete ? ['ON DELETE', field.onDelete.toUpperCase()] : [])] : []),
        ...(field.default ? ['DEFAULT', field.default] : []),
        ...(field.assertion ? ['ASSERT', field.assertion] : []),
        ...(field.readonly ? ['READONLY'] : []),
        ...(field.comment ? [`COMMENT ${surrealString(field.comment)}`] : [])
    ];
    return `${clauses.join(' ')};`;
}

export function compileDefineFieldAndIndexStatements(
    model: CompiledSurrealModel,
    field: CompiledSurrealField,
    models: CompiledSurrealModel[]
): string[] {
    if (!field.storage) {
        return [];
    }

    return [
        compileDefineFieldStatementWithContext(model, field, models),
        ...compileDefineIndexStatements(model, field)
    ];
}

export function compileDefineIndexStatements(model: CompiledSurrealModel, field: CompiledSurrealField): string[] {
    const statements: string[] = [];
    appendIndexStatements(model, field, field.name, statements);
    return statements;
}

function compileDefineFieldStatementWithContext(
    model: CompiledSurrealModel,
    field: CompiledSurrealField,
    models: CompiledSurrealModel[]
): string {
    const fieldType = compileFieldType(model, field, models);
    const clauses = [
        'DEFINE FIELD',
        surrealFieldPath(field.name),
        'ON TABLE',
        surrealIdentifier(model.table),
        ...(field.compute ? ['COMPUTED', field.compute] : []),
        ...(!field.compute && fieldType ? ['TYPE', fieldType] : []),
        ...(field.value ? ['VALUE', field.value] : []),
        ...(field.flexible ? ['FLEXIBLE'] : []),
        ...(field.reference ? ['REFERENCE', ...(field.onDelete ? ['ON DELETE', field.onDelete.toUpperCase()] : [])] : []),
        ...(field.default ? ['DEFAULT', field.default] : []),
        ...(field.assertion ? ['ASSERT', field.assertion] : []),
        ...(field.readonly ? ['READONLY'] : []),
        ...(field.comment ? [`COMMENT ${surrealString(field.comment)}`] : [])
    ];
    return `${clauses.join(' ')};`;
}

function compileDefineAnalyzerStatement(analyzer: CompiledSurrealModel['analyzers'][number]): string {
    return [
        'DEFINE ANALYZER',
        surrealIdentifier(analyzer.name),
        'TOKENIZERS',
        analyzer.tokenizers.map(surrealIdentifier).join(', '),
        'FILTERS',
        analyzer.filters.join(', ')
    ].join(' ') + ';';
}

function compileDefineTableIndexStatement(
    model: CompiledSurrealModel,
    index: CompiledSurrealModel['indexes'][number]
): string {
    return [
        'DEFINE INDEX',
        surrealIdentifier(index.name),
        'ON TABLE',
        surrealIdentifier(model.table),
        'FIELDS',
        index.fields.map(surrealFieldPath).join(', '),
        ...(index.fulltext ? compileFullTextIndexClauses(index.fulltext) : []),
        ...(index.unique ? ['UNIQUE'] : [])
    ].join(' ') + ';';
}

function compileFullTextIndexClauses(fulltext: NonNullable<CompiledSurrealModel['indexes'][number]['fulltext']>): string[] {
    return [
        'FULLTEXT ANALYZER',
        surrealIdentifier(fulltext.analyzer),
        ...(fulltext.bm25 === true ? ['BM25'] : typeof fulltext.bm25 === 'string' ? [`BM25${fulltext.bm25}`] : []),
        ...(fulltext.highlights ? ['HIGHLIGHTS'] : [])
    ];
}

function compileFieldType(
    model: CompiledSurrealModel,
    field: CompiledSurrealField,
    models: CompiledSurrealModel[]
): string | undefined {
    let type = field.type;

    if (field.reference) {
        const tableByModelName = new Map(models.map((candidate) => [candidate.name.toLowerCase(), candidate.table]));
        const referencedTables = field.reference.split('|').map((name) => {
            const trimmedName = name.trim();
            return tableByModelName.get(trimmedName.toLowerCase()) ?? trimmedName;
        });
        type = `record<${referencedTables.join('|')}>`;
    } else if (model.kind === 'relation' && (field.name === 'in' || field.name === 'out')) {
        type = 'record';
    }

    if (!type) {
        return undefined;
    }

    if (field.array) {
        type = `array<${type}>`;
    }
    if (field.optional || field.nullable) {
        type = `option<${type}>`;
    }
    return type;
}

function appendIndexStatements(
    model: CompiledSurrealModel,
    field: CompiledSurrealField,
    path: string,
    statements: string[]
): void {
    if (field.index) {
        if (typeof field.index === 'object' && field.index.kind === 'hnsw') {
            if (!field.index.dimension) {
                throw new Error(`Missing vector index dimension for ${model.table}.${path}.`);
            }

            statements.push(
                [
                    'DEFINE INDEX',
                    surrealIdentifier(indexName(model.table, path, 'hnsw_idx')),
                    'ON TABLE',
                    surrealIdentifier(model.table),
                    'FIELDS',
                    surrealFieldPath(path),
                    'HNSW',
                    'DIMENSION',
                    String(field.index.dimension),
                    'DIST',
                    field.index.distance ?? 'COSINE',
                    'TYPE',
                    field.index.vectorType ?? 'F32',
                    ...(field.index.concurrently === false ? [] : ['CONCURRENTLY'])
                ].join(' ') + ';'
            );
        } else {
            statements.push(
                [
                    'DEFINE INDEX',
                    surrealIdentifier(indexName(model.table, path, 'idx')),
                    'ON TABLE',
                    surrealIdentifier(model.table),
                    'FIELDS',
                    surrealFieldPath(path),
                    ...(field.index === 'unique' ? ['UNIQUE'] : [])
                ].join(' ') + ';'
            );
        }
    }

    if (field.searchable) {
        statements.push(
            [
                'DEFINE INDEX',
                surrealIdentifier(indexName(model.table, path, 'ft_idx')),
                'ON TABLE',
                surrealIdentifier(model.table),
                'FIELDS',
                surrealFieldPath(path),
                'FULLTEXT ANALYZER default_text_analyzer BM25(1.2,0.75) HIGHLIGHTS'
            ].join(' ') + ';'
        );
    }
}

function compilePruneStatements(models: CompiledSurrealModel[], currentState: Map<string, TableSchemaState>): string[] {
    const statements: string[] = [];
    for (const model of models) {
        const state = currentState.get(model.table);
        if (!state) {
            continue;
        }

        const validFields = new Set(['id', ...Object.values(model.fields).filter((field) => field.storage).map((field) => field.name)]);
        const validIndexes = new Set<string>();
        for (const field of Object.values(model.fields).filter((candidate) => candidate.storage)) {
            if (field.index) {
                validIndexes.add(indexName(model.table, field.name, typeof field.index === 'object' ? 'hnsw_idx' : 'idx'));
            }
            if (field.searchable) {
                validIndexes.add(indexName(model.table, field.name, 'ft_idx'));
            }
        }

        for (const fieldName of state.fields) {
            if (!validFields.has(fieldName)) {
                statements.push(`REMOVE FIELD ${surrealIdentifier(fieldName)} ON TABLE ${surrealIdentifier(model.table)};`);
            }
        }
        for (const indexName of state.indexes) {
            if (!validIndexes.has(indexName)) {
                statements.push(`REMOVE INDEX ${surrealIdentifier(indexName)} ON TABLE ${surrealIdentifier(model.table)};`);
            }
        }
    }
    return statements;
}

export function surrealIdentifier(identifier: string): string {
    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
        throw new Error('Surreal identifier cannot be empty.');
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalizedIdentifier)) {
        return normalizedIdentifier;
    }
    return `\`${normalizedIdentifier.replaceAll('`', '\\`')}\``;
}

export function surrealFieldPath(path: string): string {
    return path.split('.').map((segment) => segment === '*' ? '*' : surrealIdentifier(segment)).join('.');
}

export function surrealString(value: string): string {
    return JSON.stringify(value);
}

function sanitizeIndexName(path: string): string {
    return path
        .replace(/[^a-zA-Z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .toLowerCase();
}

function indexName(table: string, path: string, suffix: string): string {
    return sanitizeIndexName(`${table}_${path}_${suffix}`);
}