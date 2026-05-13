import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { EntryContext } from './entryContext.js';

export async function runOpenMissionWebCommand(context: EntryContext): Promise<void> {
    const webPackageRoot = resolveOpenMissionWebPackageRoot();
    const webBuildRoot = path.join(webPackageRoot, 'build');
    const webEntryPath = path.join(webBuildRoot, 'index.js');
    const host = process.env['HOST']?.trim() || '127.0.0.1';
    const port = process.env['PORT']?.trim() || '5174';
    const url = `http://${host}:${port}`;

    if (!context.json) {
        process.stdout.write(`Open Mission web listening at ${url}\n`);
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
            OPEN_MISSION_SURFACE_PATH: process.env['OPEN_MISSION_SURFACE_PATH']?.trim() || context.repositoryRootPath,
            OPEN_MISSION_REPOSITORY_ROOT: context.repositoryRootPath,
            OPEN_MISSION_ENTRY_CWD: context.workingDirectory
        }
    });

    await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Open Mission web exited from signal ${signal}.`));
                return;
            }
            if ((code ?? 0) !== 0) {
                reject(new Error(`Open Mission web exited with code ${String(code ?? 1)}.`));
                return;
            }
            resolve();
        });
    });
}

function resolveOpenMissionWebPackageRoot(): string {
    const require = createRequire(import.meta.url);
    try {
        return path.dirname(require.resolve('@flying-pillow/open-mission-web/package.json'));
    } catch (error) {
        throw new Error(
            `Open Mission could not find the Open Mission web package. Install '@flying-pillow/open-mission' with its dependencies before launching. ${formatError(error)}`
        );
    }
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
