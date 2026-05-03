import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDirectory, '../../../..');

function resolveWorkspaceTsxLoader() {
    const pnpmStorePath = path.join(workspaceRoot, 'node_modules', '.pnpm');
    const tsxEntry = fs.readdirSync(pnpmStorePath).find((entry) => entry.startsWith('tsx@'));
    if (!tsxEntry) {
        throw new Error(`Unable to resolve tsx loader from ${pnpmStorePath}.`);
    }

    return path.join(
        pnpmStorePath,
        tsxEntry,
        'node_modules',
        'tsx',
        'dist',
        'esm',
        'index.mjs'
    );
}

function withDevelopmentCondition(nodeOptions) {
    const trimmed = nodeOptions?.trim();
    const conditionFlag = '--conditions=development';
    const tsxLoaderFlag = `--import ${resolveWorkspaceTsxLoader()}`;

    if (!trimmed) {
        return `${conditionFlag} ${tsxLoaderFlag}`;
    }

    const withCondition = trimmed.includes(conditionFlag)
        ? trimmed
        : `${trimmed} ${conditionFlag}`;

    return withCondition.includes(tsxLoaderFlag)
        ? withCondition
        : `${withCondition} ${tsxLoaderFlag}`;
}

function hasFlag(args, flag) {
    return args.includes(flag);
}

function withDefaults(args) {
    const nextArgs = [...args];

    if (!hasFlag(nextArgs, '--host')) {
        nextArgs.push('--host', '0.0.0.0');
    }
    if (!hasFlag(nextArgs, '--port')) {
        nextArgs.push('--port', '5174');
    }
    if (!hasFlag(nextArgs, '--strictPort')) {
        nextArgs.push('--strictPort');
    }

    return nextArgs;
}

function tryKill(pattern) {
    spawnSync('pkill', ['-f', pattern], { stdio: 'ignore' });
}

const userArgs = process.argv.slice(2);
const vpArgs = withDefaults(userArgs);

// Kill stale dev processes before restart so strictPort can reliably bind the default port.
tryKill('apps/airport/web.*vp dev');
tryKill('vite-plus-core.*/dist/vite/node/cli.js dev');

const child = spawn('pnpm', ['exec', 'vp', 'dev', ...vpArgs], {
    stdio: 'inherit',
    env: {
        ...process.env,
        NODE_OPTIONS: withDevelopmentCondition(process.env.NODE_OPTIONS)
    }
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
