import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
    compileDefineStatements,
    compileSchema,
    compileSelectQuery,
    defineModel,
    field as surrealField,
    getFieldMetadata,
    getTableMetadata,
    table as surrealTable
} from './index.js';

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
});