import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vitePlusRequire = createRequire(import.meta.resolve('vite-plus/package.json'));
const { createServer } = await import(vitePlusRequire.resolve('@voidzero-dev/vite-plus-core'));

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const daemonEntry = '/src/daemon/startDaemon.ts';
const runtimeFactoryModulePath = path.join(packageRoot, 'src', 'daemon', 'runtime', 'agent', 'runtimes', 'AgentRuntimeFactory.ts');

process.env.MISSION_DAEMON_RUNTIME_MODE = 'source';
process.env.MISSION_RUNTIME_FACTORY_MODULE = process.env.MISSION_RUNTIME_FACTORY_MODULE?.trim() || runtimeFactoryModulePath;

const server = await createServer({
	root: packageRoot,
	appType: 'custom',
	clearScreen: false,
	logLevel: 'info',
	server: {
		middlewareMode: true,
		hmr: false,
		watch: {
			ignored: ['**/build/**', '**/node_modules/**']
		}
	}
});

let daemonHandle;
let daemonModule;
let reloadSequence = 0;
let reloadTimer;
let reloadInFlight = Promise.resolve();
let shuttingDown = false;

await startDaemon();
server.watcher.add(path.join(packageRoot, 'src/**/*.ts'));
server.watcher.on('change', queueReload);
server.watcher.on('add', queueReload);
server.watcher.on('unlink', queueReload);

process.stdout.write('Mission daemon dev runtime ready (Vite+ SSR source loader).\n');

process.once('SIGINT', () => {
	void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
	void shutdown('SIGTERM');
});

await new Promise(() => undefined);

function queueReload(filePath) {
	if (shuttingDown || !isSourceFile(filePath)) {
		return;
	}

	clearTimeout(reloadTimer);
	reloadTimer = setTimeout(() => {
		reloadInFlight = reloadInFlight.then(() => reloadDaemon(filePath)).catch((error) => {
			process.stderr.write(`Mission daemon reload failed: ${formatError(error)}\n`);
		});
	}, 100);
}

async function reloadDaemon(filePath) {
	process.stdout.write(`Mission daemon source changed: ${path.relative(packageRoot, filePath)}\n`);
	server.moduleGraph.invalidateAll();
	const nextModule = await loadDaemonModule();
	const previousModule = daemonModule;
	const previousHandle = daemonHandle;
	await previousHandle?.dispose();
	await previousHandle?.closed;
	try {
		daemonHandle = await startDaemonFromModule(nextModule);
		daemonModule = nextModule;
	} catch (error) {
		if (previousModule) {
			process.stderr.write(`Mission daemon reload rollback: ${formatError(error)}\n`);
			daemonHandle = await startDaemonFromModule(previousModule);
			daemonModule = previousModule;
			process.stderr.write('Mission daemon rollback completed.\n');
			return;
		}
		throw error;
	}
	process.stdout.write('Mission daemon reloaded.\n');
}

async function startDaemon() {
	const module = await loadDaemonModule();
	daemonHandle = await startDaemonFromModule(module);
	daemonModule = module;
}

async function loadDaemonModule() {
	reloadSequence += 1;
	const module = await server.ssrLoadModule(`${daemonEntry}?reload=${reloadSequence}`);
	if (typeof module.startMissionDaemon !== 'function') {
		throw new TypeError('Daemon entry does not export startMissionDaemon().');
	}
	return module;
}

async function startDaemonFromModule(module) {
	return await module.startMissionDaemon({
		argv: process.argv.slice(2),
		surfacePath: process.env.MISSION_SURFACE_PATH,
		installSignalHandlers: false
	});
}

async function shutdown(signal) {
	if (shuttingDown) {
		return;
	}

	shuttingDown = true;
	clearTimeout(reloadTimer);
	try {
		await reloadInFlight;
		await daemonHandle?.dispose();
		await server.close();
	} finally {
		process.kill(process.pid, signal);
	}
}

function isSourceFile(filePath) {
	const relativePath = path.relative(packageRoot, filePath);
	return relativePath.startsWith('src/') && relativePath.endsWith('.ts');
}

function formatError(error) {
	return error instanceof Error ? error.stack ?? error.message : String(error);
}