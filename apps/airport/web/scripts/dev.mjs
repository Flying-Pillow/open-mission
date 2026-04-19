import { spawn, spawnSync } from 'node:child_process';

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
    stdio: 'inherit'
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
