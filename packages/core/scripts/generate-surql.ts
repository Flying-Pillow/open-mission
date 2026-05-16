import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
    compileDefineAnalyzerStatement,
    compileDefineFieldAndIndexStatements,
    compileDefineTableIndexStatement,
    compileDefineTableStatement,
    compileSchema,
    defineModel,
    getTableMetadata
} from '@flying-pillow/zod-surreal';
import type { z } from 'zod/v4';

type GeneratedSchema = {
    entityName: string;
    fileName: string;
    statements: string[];
    tableName: string;
};

type LoadedSchemaModel = {
    entityName: string;
    schema: z.ZodObject;
    tableName: string;
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, '..');
const entitiesDirectory = path.join(packageRoot, 'src/entities');
const outputDirectory = path.join(packageRoot, 'src/lib/database/schema');

const schemaFilePattern = /^[A-Z][A-Za-z0-9]*Schema\.ts$/;
const storageSchemaExportPattern = /^[A-Z][A-Za-z0-9]*StorageSchema$/;

const schemaFiles = await findEntitySchemaFiles(entitiesDirectory);
const loadedModels: LoadedSchemaModel[] = [];
const generatedSchemas: GeneratedSchema[] = [];
const skippedSchemas: string[] = [];
const failedSchemas: string[] = [];

for (const schemaFile of schemaFiles) {
    const relativeSchemaFile = path.relative(packageRoot, schemaFile);
    const moduleUrl = pathToFileURL(schemaFile).href;
    const schemaModule = await import(moduleUrl).catch((error: unknown) => {
        failedSchemas.push(`${relativeSchemaFile}: ${formatError(error)}`);
        return undefined;
    }) as Record<string, unknown> | undefined;

    if (!schemaModule) {
        continue;
    }

    const moduleSchemas = Object.entries(schemaModule)
        .filter(([exportName, schema]) => storageSchemaExportPattern.test(exportName) && isZodObject(schema))
        .flatMap(([exportName, schema]) => {
            try {
                return loadStorageSchema(exportName, schema);
            } catch (error) {
                failedSchemas.push(`${relativeSchemaFile}:${exportName}: ${formatError(error)}`);
                return [];
            }
        });

    if (moduleSchemas.length === 0) {
        skippedSchemas.push(relativeSchemaFile);
        continue;
    }

    loadedModels.push(...moduleSchemas);
}

try {
    const snapshot = compileSchema({
        models: loadedModels.map((model) => defineModel({
            name: model.entityName,
            schema: model.schema
        }))
    });
    const compiledModels = Object.values(snapshot.models);
    const ddlContext = { overwrite: true, implicitFullTextIndexes: [] };

    for (const model of loadedModels) {
        const compiledModel = snapshot.models[model.entityName];
        if (!compiledModel) {
            failedSchemas.push(`${model.entityName}: compiled model was not found in the generated snapshot.`);
            continue;
        }

        generatedSchemas.push({
            entityName: model.entityName,
            fileName: `${model.tableName}.surql`,
            tableName: model.tableName,
            statements: [
                ...compiledModel.analyzers.map((analyzer) => compileDefineAnalyzerStatement(analyzer, ddlContext)),
                compileDefineTableStatement(compiledModel, ddlContext),
                ...Object.values(compiledModel.fields).flatMap((field) => compileDefineFieldAndIndexStatements(compiledModel, field, compiledModels, ddlContext)),
                ...compiledModel.indexes.map((index) => compileDefineTableIndexStatement(compiledModel, index, ddlContext))
            ]
        });
    }
} catch (error) {
    failedSchemas.push(`schema compilation: ${formatError(error)}`);
}

await mkdir(outputDirectory, { recursive: true });
await removeGeneratedSurqlFiles(outputDirectory);

for (const generatedSchema of generatedSchemas) {
    await writeFile(
        path.join(outputDirectory, generatedSchema.fileName),
        `${generatedSchema.statements.join('\n')}\n`,
        'utf8'
    );
}

process.stdout.write(formatSummary(generatedSchemas, skippedSchemas, failedSchemas));

async function findEntitySchemaFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return findEntitySchemaFiles(entryPath);
        }
        if (entry.isFile() && schemaFilePattern.test(entry.name)) {
            return [entryPath];
        }
        return [];
    }));

    return files.flat().sort((left, right) => left.localeCompare(right));
}

function loadStorageSchema(exportName: string, schema: z.ZodObject): LoadedSchemaModel[] {
    const tableMetadata = getTableMetadata(schema);
    if (!tableMetadata) {
        return [];
    }

    return [{
        entityName: exportName.replace(/StorageSchema$/, ''),
        schema,
        tableName: tableMetadata.table
    }];
}

function isZodObject(value: unknown): value is z.ZodObject {
    return Boolean(value && typeof value === 'object' && 'shape' in value);
}

async function removeGeneratedSurqlFiles(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    });

    await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.surql'))
        .map((entry) => rm(path.join(directory, entry.name))));
}

function formatSummary(generatedSchemas: GeneratedSchema[], skippedSchemas: string[], failedSchemas: string[]): string {
    const generatedLines = generatedSchemas.length === 0
        ? ['No SurrealDB schemas generated.']
        : generatedSchemas.map((schema) => `Generated ${path.relative(packageRoot, path.join(outputDirectory, schema.fileName))} from ${schema.entityName} (${schema.tableName}).`);
    const skippedLines = skippedSchemas.map((schemaFile) => `Skipped ${schemaFile}; no table-registered StorageSchema export found.`);
    const failedLines = failedSchemas.map((schemaFile) => `Skipped ${schemaFile}`);

    return [...generatedLines, ...skippedLines, ...failedLines].join('\n') + '\n';
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
}