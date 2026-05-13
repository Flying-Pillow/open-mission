import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
    compileDdlPlan,
    compileDefineStatements,
    compileSchema,
    compileSelectQuery,
    defineModel,
    field as surrealField,
    getFieldMetadata,
    getTableMetadata,
    table as surrealTable,
    type CompiledSurrealField,
    type CompiledSurrealModel,
    type CompiledSurrealSchemaSnapshot
} from './index.js';

const makeField = (overrides: Partial<CompiledSurrealField>): CompiledSurrealField => ({
    name: 'name',
    type: 'string',
    array: false,
    optional: false,
    nullable: false,
    flexible: false,
    index: false,
    sortIndex: false,
    searchable: false,
    sensitive: false,
    storage: true,
    readonly: false,
    ...overrides
});

const makeModel = (overrides: Partial<CompiledSurrealModel>): CompiledSurrealModel => ({
    name: 'User',
    scope: 'tenant',
    databaseKey: 'tenant',
    table: 'user',
    kind: 'normal',
    schemafull: true,
    omitSchemaMode: true,
    inputSchemaName: 'UserInput',
    storageSchemaName: 'UserStorage',
    dataSchemaName: 'UserData',
    fields: {
        email: makeField({ name: 'email', index: 'unique', searchable: true }),
        orgId: makeField({ name: 'orgId', reference: 'Organization', onDelete: 'cascade' })
    },
    analyzers: [],
    indexes: [],
    relationships: [],
    ...overrides
});

const makeSnapshot = (models: CompiledSurrealModel[]): CompiledSurrealSchemaSnapshot => ({
    artifactVersion: '1',
    models: Object.fromEntries(models.map((model) => [model.name, model]))
});

const defaultTextAnalyzer = {
    name: 'default_text_analyzer',
    tokenizers: ['class', 'punct'],
    filters: ['lowercase', 'ascii', 'snowball(dutch)']
};

describe('zod-surreal model compilation', () => {
    it('compiles Zod table and field metadata into a deterministic snapshot', () => {
        const ArticleSchema = z.object({
            author: z.string().register(surrealField, { reference: 'Author', onDelete: 'unset', comment: 'Owning author.' }),
            title: z.string().register(surrealField, { type: 'string' }),
            ignoredRuntimeOnlyValue: z.string().optional()
        }).strict().register(surrealTable, {
            table: 'article',
            schemafull: true
        });

        const ArticleStorageSchema = z.object({
            author: z.string(),
            title: z.string()
        }).strict();

        expect(getTableMetadata(ArticleSchema)).toEqual({
            table: 'article',
            schemafull: true
        });
        expect(getFieldMetadata(ArticleSchema.shape.title)).toEqual({
            type: 'string'
        });

        expect(compileSchema({
            models: [defineModel({ name: 'Article', schema: ArticleSchema, storageSchema: ArticleStorageSchema })]
        })).toEqual({
            artifactVersion: '1',
            models: {
                Article: {
                    name: 'Article',
                    scope: 'tenant',
                    databaseKey: 'tenant',
                    table: 'article',
                    kind: 'normal',
                    schemafull: true,
                    omitSchemaMode: false,
                    inputSchemaName: 'ArticleInput',
                    storageSchemaName: 'ArticleStorage',
                    dataSchemaName: 'ArticleData',
                    fields: {
                        author: {
                            name: 'author',
                            reference: 'Author',
                            type: 'string',
                            array: false,
                            optional: false,
                            nullable: false,
                            flexible: false,
                            onDelete: 'unset',
                            index: false,
                            sortIndex: false,
                            searchable: false,
                            sensitive: false,
                            storage: true,
                            readonly: false,
                            comment: 'Owning author.'
                        },
                        title: {
                            name: 'title',
                            type: 'string',
                            array: false,
                            optional: false,
                            nullable: false,
                            flexible: false,
                            index: false,
                            sortIndex: false,
                            searchable: false,
                            sensitive: false,
                            storage: true,
                            readonly: false
                        }
                    },
                    analyzers: [],
                    indexes: [],
                    relationships: []
                }
            }
        });
    });

    it('renders conservative Surreal define statements', () => {
        const AuthorSchema = z.object({
            name: z.string().register(surrealField, { type: 'string' })
        }).strict().register(surrealTable, {
            table: 'author'
        });
        const ArticleSchema = z.object({
            'author id': z.string().register(surrealField, { reference: 'Author', onDelete: 'unset' }),
            title: z.string().register(surrealField, { type: 'string', assertion: '$value != ""', index: 'unique' })
        }).strict().register(surrealTable, {
            table: 'article post',
            schemafull: true,
            comment: 'Hydrated article record.'
        });

        const snapshot = compileSchema({
            models: [
                defineModel({ name: 'Article', schema: ArticleSchema }),
                defineModel({ name: 'Author', schema: AuthorSchema })
            ]
        });

        expect(compileDefineStatements(snapshot)).toEqual([
            'DEFINE TABLE `article post` TYPE NORMAL SCHEMAFULL COMMENT "Hydrated article record.";',
            'DEFINE FIELD `author id` ON TABLE `article post` TYPE record<author> REFERENCE ON DELETE UNSET;',
            'DEFINE FIELD title ON TABLE `article post` TYPE string ASSERT $value != "";',
            'DEFINE INDEX article_post_title_idx ON TABLE `article post` FIELDS title UNIQUE;',
            'DEFINE TABLE author TYPE NORMAL SCHEMAFULL;',
            'DEFINE FIELD name ON TABLE author TYPE string;'
        ]);
    });

    it('infers Surreal field types from Zod schemas', () => {
        const InferredSchema = z.object({
            title: z.string().register(surrealField, { storage: true }),
            score: z.number().register(surrealField, { storage: true }),
            count: z.number().int().register(surrealField, { storage: true }),
            enabled: z.boolean().register(surrealField, { storage: true }),
            publishedAt: z.date().register(surrealField, { storage: true }),
            status: z.enum(['draft', 'published']).register(surrealField, { storage: true }),
            tags: z.array(z.string()).register(surrealField, { storage: true }),
            optionalTitle: z.string().optional().register(surrealField, { storage: true }),
            nullableTitle: z.string().nullable().register(surrealField, { storage: true }),
            metadata: z.object({ nested: z.string() }).register(surrealField, { storage: true })
        }).strict().register(surrealTable, {
            table: 'inferred'
        });

        const snapshot = compileSchema({
            models: [defineModel({ name: 'Inferred', schema: InferredSchema })]
        });

        expect(compileDefineStatements(snapshot)).toEqual([
            'DEFINE TABLE inferred TYPE NORMAL SCHEMAFULL;',
            'DEFINE FIELD count ON TABLE inferred TYPE int;',
            'DEFINE FIELD enabled ON TABLE inferred TYPE bool;',
            'DEFINE FIELD metadata ON TABLE inferred TYPE object;',
            'DEFINE FIELD nullableTitle ON TABLE inferred TYPE option<string>;',
            'DEFINE FIELD optionalTitle ON TABLE inferred TYPE option<string>;',
            'DEFINE FIELD publishedAt ON TABLE inferred TYPE datetime;',
            'DEFINE FIELD score ON TABLE inferred TYPE number;',
            'DEFINE FIELD status ON TABLE inferred TYPE string;',
            'DEFINE FIELD tags ON TABLE inferred TYPE array<string>;',
            'DEFINE FIELD title ON TABLE inferred TYPE string;'
        ]);
    });

    it('compiles select queries with bindings and runtime computed fields', () => {
        expect(compileSelectQuery({
            from: 'article',
            where: { field: 'author', value: 'author:123' },
            orderBy: { field: 'title' },
            limit: 10,
            fetch: ['author']
        }, {
            title: { name: 'title', storage: true },
            summary: { name: 'summary', storage: false, compute: 'string::slice(body, 0, 120)' }
        }, {
            defaultTable: 'article',
            isRecordIdString: (value) => value.includes(':'),
            toRecordId: (value) => ({ recordId: value })
        })).toEqual({
            query: 'SELECT *, string::slice(body, 0, 120) AS summary FROM type::table($tb) WHERE author = $where_value_0 ORDER BY title ASC LIMIT $limit FETCH author',
            bindings: {
                tb: 'article',
                where_value_0: { recordId: 'author:123' },
                limit: 10
            }
        });
    });

    it('renders overwrite DDL, configured analyzers, references, and fulltext indexes', () => {
        const user = makeModel({});
        const organization = makeModel({
            name: 'Organization',
            table: 'organization',
            fields: {
                name: makeField({ name: 'name' })
            }
        });

        const plan = compileDdlPlan({
            snapshot: makeSnapshot([user, organization]),
            scope: 'tenant',
            overwrite: true,
            analyzers: [defaultTextAnalyzer]
        });

        expect(plan.tables).toEqual(['user', 'organization']);
        expect(plan.statements).toContain('DEFINE ANALYZER OVERWRITE default_text_analyzer TOKENIZERS class, punct FILTERS lowercase, ascii, snowball(dutch);');
        expect(plan.statements).toContain('DEFINE TABLE OVERWRITE user TYPE NORMAL;');
        expect(plan.statements).toContain('DEFINE FIELD OVERWRITE orgId ON TABLE user TYPE record<organization> REFERENCE ON DELETE CASCADE;');
        expect(plan.statements).toContain('DEFINE INDEX OVERWRITE user_email_idx ON TABLE user FIELDS email UNIQUE;');
        expect(plan.statements).toContain('DEFINE INDEX OVERWRITE user_email_ft_idx ON TABLE user FIELDS email FULLTEXT ANALYZER default_text_analyzer BM25(1.2,0.75) HIGHLIGHTS;');
    });

    it('emits prune statements for stale fields and indexes', () => {
        const user = makeModel({
            fields: {
                email: makeField({ name: 'email', index: 'normal' }),
                virtualOnly: makeField({ name: 'virtualOnly', storage: false, compute: '->edge.*' })
            }
        });
        const currentState = new Map([
            [
                'user',
                {
                    fields: new Set(['id', 'email', 'legacyField']),
                    indexes: new Set(['user_email_idx', 'user_legacy_idx'])
                }
            ]
        ]);

        const plan = compileDdlPlan({
            snapshot: makeSnapshot([user]),
            scope: 'tenant',
            prune: true,
            currentState
        });

        expect(plan.statements).toContain('REMOVE FIELD legacyField ON TABLE user;');
        expect(plan.statements).toContain('REMOVE INDEX user_legacy_idx ON TABLE user;');
    });

    it('throws when a referenced model or table is unknown', () => {
        const user = makeModel({
            fields: {
                ownerId: makeField({ name: 'ownerId', reference: 'MissingEntity' })
            }
        });

        expect(() => compileDdlPlan({
            snapshot: makeSnapshot([user]),
            scope: 'tenant'
        })).toThrow("Unknown referenced entity 'MissingEntity'");
    });

    it('uses record type for relation in and out fields', () => {
        const edgeModel = makeModel({
            name: 'MemberEdge',
            table: 'member_edge',
            kind: 'relation',
            fields: {
                in: makeField({ name: 'in', type: 'string' }),
                out: makeField({ name: 'out', type: 'string' })
            }
        });

        const plan = compileDdlPlan({
            snapshot: makeSnapshot([edgeModel]),
            scope: 'tenant',
            overwrite: true
        });

        expect(plan.statements).toContain('DEFINE TABLE OVERWRITE member_edge TYPE RELATION;');
        expect(plan.statements).toContain('DEFINE FIELD OVERWRITE in ON TABLE member_edge TYPE record;');
        expect(plan.statements).toContain('DEFINE FIELD OVERWRITE out ON TABLE member_edge TYPE record;');
    });

    it('emits index statements for nested object fields', () => {
        const model = makeModel({
            name: 'ArtifactVector',
            table: 'artifact_vector',
            fields: {
                text: makeField({ name: 'text', searchable: true }),
                metadata: makeField({
                    name: 'metadata',
                    type: 'object',
                    fields: {
                        source: makeField({ name: 'source', storage: false, searchable: true }),
                        title: makeField({ name: 'title', storage: false, searchable: true })
                    }
                })
            }
        });

        const plan = compileDdlPlan({
            snapshot: makeSnapshot([model]),
            scope: 'tenant',
            overwrite: true
        });

        expect(plan.statements).toContain('DEFINE INDEX OVERWRITE artifact_vector_text_ft_idx ON TABLE artifact_vector FIELDS text FULLTEXT ANALYZER default_text_analyzer BM25(1.2,0.75) HIGHLIGHTS;');
        expect(plan.statements).toContain('DEFINE INDEX OVERWRITE artifact_vector_metadata_source_ft_idx ON TABLE artifact_vector FIELDS metadata.source FULLTEXT ANALYZER default_text_analyzer BM25(1.2,0.75) HIGHLIGHTS;');
        expect(plan.statements).toContain('DEFINE INDEX OVERWRITE artifact_vector_metadata_title_ft_idx ON TABLE artifact_vector FIELDS metadata.title FULLTEXT ANALYZER default_text_analyzer BM25(1.2,0.75) HIGHLIGHTS;');
    });

    it('emits configured implicit fulltext indexes', () => {
        const model = makeModel({
            name: 'ArtifactVector',
            table: 'artifact_vector',
            fields: {
                text: makeField({ name: 'text', type: 'string', searchable: false })
            }
        });

        const plan = compileDdlPlan({
            snapshot: makeSnapshot([model]),
            scope: 'tenant',
            overwrite: true,
            implicitFullTextIndexes: [{ table: 'artifact_vector', path: 'text' }]
        });

        expect(plan.statements).toContain('DEFINE INDEX OVERWRITE artifact_vector_text_ft_idx ON TABLE artifact_vector FIELDS text FULLTEXT ANALYZER default_text_analyzer BM25(1.2,0.75) HIGHLIGHTS;');
    });

    it('emits hnsw indexes and validates vector dimensions', () => {
        const model = makeModel({
            name: 'ArtifactVector',
            table: 'artifact_vector',
            fields: {
                vector: makeField({
                    name: 'vector',
                    type: 'number',
                    array: true,
                    index: {
                        kind: 'hnsw',
                        dimension: 1024,
                        distance: 'COSINE',
                        vectorType: 'F32',
                        concurrently: true
                    }
                })
            }
        });

        const plan = compileDdlPlan({
            snapshot: makeSnapshot([model]),
            scope: 'tenant',
            overwrite: true
        });

        expect(plan.statements).toContain('DEFINE INDEX OVERWRITE artifact_vector_vector_hnsw_idx ON TABLE artifact_vector FIELDS vector HNSW DIMENSION 1024 DIST COSINE TYPE F32 CONCURRENTLY;');

        expect(() => compileDdlPlan({
            snapshot: makeSnapshot([
                makeModel({
                    name: 'ArtifactVector',
                    table: 'artifact_vector',
                    fields: {
                        vector: makeField({
                            name: 'vector',
                            type: 'number',
                            array: true,
                            index: {
                                kind: 'hnsw',
                                distance: 'COSINE',
                                vectorType: 'F32',
                                concurrently: true
                            }
                        })
                    }
                })
            ]),
            scope: 'tenant'
        })).toThrow('Missing vector index dimension');
    });
});
