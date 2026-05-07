import { spawn } from 'node:child_process';
import * as fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntryContext } from './entryContext.js';

export type NativeAirportCommand = 'native:dev' | 'native:build';

export async function runAirportNativeCommand(
    command: NativeAirportCommand,
    context: EntryContext
): Promise<void> {
    const nativePackageRoot = resolveAirportNativePackageRoot();
    const script = command === 'native:build' ? 'build' : 'dev';
    const child = spawn('pnpm', ['run', script, ...context.args], {
        cwd: nativePackageRoot,
        stdio: 'inherit',
        env: {
            ...process.env,
            MISSION_REPOSITORY_ROOT: context.repositoryRootPath,
            MISSION_ENTRY_CWD: context.workingDirectory
        }
    });

    await new Promise<void>((resolve, reject) => {
        child.once('error', (error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                reject(
                    new Error(
                        "Mission could not execute pnpm. Install Node 24 with Corepack-enabled pnpm before launching the native host."
                    )
                );
                return;
            }
            reject(error);
        });
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Mission native host exited from signal ${signal}.`));
                return;
            }
            if ((code ?? 0) !== 0) {
                reject(new Error(`Mission native host exited with code ${String(code ?? 1)}.`));
                return;
            }
            resolve();
        });
    });
}

function resolveAirportNativePackageRoot(): string {
    const configuredPath = process.env['MISSION_NATIVE_APP_PATH']?.trim();
    if (configuredPath) {
        const resolvedConfiguredPath = path.resolve(configuredPath);
        if (fsSync.existsSync(path.join(resolvedConfiguredPath, 'package.json'))) {
            return resolvedConfiguredPath;
        }
    }

    const currentFilePath = fileURLToPath(import.meta.url);
    const monorepoPath = path.resolve(path.dirname(currentFilePath), '..', '..', '..', 'apps', 'airport', 'native');
    if (fsSync.existsSync(path.join(monorepoPath, 'package.json'))) {
        return monorepoPath;
    }

    throw new Error(
        'Mission could not find the native Airport host at apps/airport/native. Restore or configure MISSION_NATIVE_APP_PATH before launching Mission.'
    );
}
