import { spawn } from 'node:child_process';
import * as fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntryContext } from './entryContext.js';

export type OpenMissionNativeCommand = 'native:dev' | 'native:build';

export async function runOpenMissionNativeCommand(
    command: OpenMissionNativeCommand,
    context: EntryContext
): Promise<void> {
    const nativePackageRoot = resolveOpenMissionNativePackageRoot();
    const script = command === 'native:build' ? 'build' : 'dev';
    const child = spawn('pnpm', ['run', script, ...context.args], {
        cwd: nativePackageRoot,
        stdio: 'inherit',
        env: {
            ...process.env,
            OPEN_MISSION_REPOSITORY_ROOT: context.repositoryRootPath,
            OPEN_MISSION_ENTRY_CWD: context.workingDirectory
        }
    });

    await new Promise<void>((resolve, reject) => {
        child.once('error', (error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                reject(
                    new Error(
                        "Open Mission could not execute pnpm. Install Node 24 with Corepack-enabled pnpm before launching the native host."
                    )
                );
                return;
            }
            reject(error);
        });
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Open Mission native host exited from signal ${signal}.`));
                return;
            }
            if ((code ?? 0) !== 0) {
                reject(new Error(`Open Mission native host exited with code ${String(code ?? 1)}.`));
                return;
            }
            resolve();
        });
    });
}

function resolveOpenMissionNativePackageRoot(): string {
    const configuredPath = process.env['OPEN_MISSION_NATIVE_APP_PATH']?.trim();
    if (configuredPath) {
        const resolvedConfiguredPath = path.resolve(configuredPath);
        if (fsSync.existsSync(path.join(resolvedConfiguredPath, 'package.json'))) {
            return resolvedConfiguredPath;
        }
    }

    const currentFilePath = fileURLToPath(import.meta.url);
    const monorepoPath = path.resolve(path.dirname(currentFilePath), '..', '..', '..', 'apps', 'native');
    if (fsSync.existsSync(path.join(monorepoPath, 'package.json'))) {
        return monorepoPath;
    }

    throw new Error(
        'Open Mission could not find the native host at apps/native. Restore or configure OPEN_MISSION_NATIVE_APP_PATH before launching Open Mission.'
    );
}
