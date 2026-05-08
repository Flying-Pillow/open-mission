import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { EntryContext } from './entryContext.js';

export async function runAirportWebCommand(context: EntryContext): Promise<void> {
    const webPackageRoot = resolveAirportWebPackageRoot();
    const webBuildRoot = path.join(webPackageRoot, 'build');
    const webEntryPath = path.join(webBuildRoot, 'index.js');
    const host = process.env['HOST']?.trim() || '127.0.0.1';
    const port = process.env['PORT']?.trim() || '5174';
    const url = `http://${host}:${port}`;

    if (!context.json) {
        process.stdout.write(`Mission Airport web listening at ${url}\n`);
    }

    const child = spawn(process.execPath, [webEntryPath, ...context.args], {
        cwd: webBuildRoot,
        stdio: 'inherit',
        env: {
            ...process.env,
            NODE_ENV: process.env['NODE_ENV']?.trim() || 'production',
            HOST: host,
            PORT: port,
            ORIGIN: process.env['ORIGIN']?.trim() || url,
            MISSION_SURFACE_PATH: process.env['MISSION_SURFACE_PATH']?.trim() || context.repositoryRootPath,
            MISSION_REPOSITORY_ROOT: context.repositoryRootPath,
            MISSION_ENTRY_CWD: context.workingDirectory
        }
    });

    await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Mission Airport web exited from signal ${signal}.`));
                return;
            }
            if ((code ?? 0) !== 0) {
                reject(new Error(`Mission Airport web exited with code ${String(code ?? 1)}.`));
                return;
            }
            resolve();
        });
    });
}

function resolveAirportWebPackageRoot(): string {
    const require = createRequire(import.meta.url);
    try {
        return path.dirname(require.resolve('@flying-pillow/mission-airport-web/package.json'));
    } catch (error) {
        throw new Error(
            `Mission could not find the Airport web package. Install '@flying-pillow/mission' with its dependencies before launching Mission. ${formatError(error)}`
        );
    }
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
