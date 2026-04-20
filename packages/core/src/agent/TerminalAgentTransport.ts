import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn as spawnPty, type IPty } from 'node-pty';

export type TerminalExecutorResult = {
    stdout: string;
    stderr: string;
};

export type TerminalExecutor = (args: string[]) => Promise<TerminalExecutorResult>;

export type TerminalSessionHandle = {
    sessionName: string;
    paneId: string;
    sharedSessionName?: string | undefined;
};

export type TerminalAgentTransportOptions = {
    terminalBinary?: string;
    logLine?: (line: string) => void;
    executor?: TerminalExecutor;
    sharedSessionName?: string;
    agentSessionPaneTitle?: string;
    discoverSharedSessionName?: boolean;
    spawn?: typeof spawnPty;
};

export type TerminalOpenSessionRequest = {
    workingDirectory: string;
    command: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
    sessionPrefix?: string;
    sessionName?: string;
    sharedSessionName?: string;
};

export type TerminalSessionSnapshot = {
    sessionName: string;
    paneId: string;
    connected: boolean;
    dead: boolean;
    exitCode: number | null;
    screen: string;
    truncated: boolean;
    chunk?: string;
    sharedSessionName?: string;
};

type PtySessionRecord = {
    sessionName: string;
    paneId: string;
    pty: IPty;
    buffer: string;
    dead: boolean;
    exitCode: number | null;
    cols: number;
    rows: number;
    truncated: boolean;
};

type PtySessionUpdate = TerminalSessionSnapshot & {
    chunk: string;
};

type PtyLaunchCommand = {
    command: string;
    args: string[];
    resolvedCommand: string;
};

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MAX_BUFFER_SIZE = 200_000;
const PTY_PANE_ID = 'pty';
const DEFAULT_UNIX_PATH_SEGMENTS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
const COPILOT_CLI_DIRECTORY_SUFFIX = path.join('User', 'globalStorage', 'github.copilot-chat', 'copilotCli');

class PtySessionRegistry {
    private readonly sessions = new Map<string, PtySessionRecord>();
    private readonly listeners = new Set<(event: PtySessionUpdate) => void>();

    public constructor(private readonly spawnImpl: typeof spawnPty, private readonly logLine?: (line: string) => void) { }

    public openSession(request: TerminalOpenSessionRequest): TerminalSessionHandle {
        const sessionName = this.resolveSessionName(request.sessionName, request.sessionPrefix);
        const command = request.command.trim();
        if (!command) {
            throw new Error('TerminalAgentTransport requires a command.');
        }

        const env = buildPtyEnv(request.env);
        const launchCommand = resolvePtyLaunchCommand(command, request.args ?? [], env);

        let pty: IPty;
        try {
            pty = this.spawnImpl(launchCommand.command, launchCommand.args, {
                name: 'xterm-256color',
                cols: DEFAULT_COLS,
                rows: DEFAULT_ROWS,
                cwd: request.workingDirectory,
                env
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const resolutionDetail = launchCommand.resolvedCommand === command
                ? ''
                : ` (resolved to '${launchCommand.resolvedCommand}')`;
            throw new Error(`Failed to spawn PTY command '${command}'${resolutionDetail}: ${detail}`);
        }
        this.logLine?.(`pty spawn ${launchCommand.command} ${launchCommand.args.join(' ')}`.trim());

        const record: PtySessionRecord = {
            sessionName,
            paneId: PTY_PANE_ID,
            pty,
            buffer: '',
            dead: false,
            exitCode: null,
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            truncated: false
        };
        this.sessions.set(sessionName, record);

        pty.onData((chunk) => {
            const appended = appendToBuffer(record.buffer, chunk);
            record.buffer = appended.buffer;
            record.truncated = record.truncated || appended.truncated;
            this.emit({
                sessionName,
                paneId: record.paneId,
                connected: true,
                dead: record.dead,
                exitCode: record.exitCode,
                screen: record.buffer,
                truncated: record.truncated,
                chunk
            });
        });

        pty.onExit(({ exitCode }) => {
            record.dead = true;
            record.exitCode = exitCode;
            this.emit({
                sessionName,
                paneId: record.paneId,
                connected: true,
                dead: true,
                exitCode,
                screen: record.buffer,
                truncated: record.truncated,
                chunk: ''
            });
        });

        return {
            sessionName,
            paneId: record.paneId
        };
    }

    public attachSession(sessionName: string): TerminalSessionHandle | undefined {
        const record = this.sessions.get(sessionName);
        if (!record) {
            return undefined;
        }
        return {
            sessionName: record.sessionName,
            paneId: record.paneId
        };
    }

    public hasSession(sessionName: string): boolean {
        return this.sessions.has(sessionName);
    }

    public readSnapshot(sessionName: string): TerminalSessionSnapshot | undefined {
        const record = this.sessions.get(sessionName);
        if (!record) {
            return undefined;
        }
        return {
            sessionName: record.sessionName,
            paneId: record.paneId,
            connected: true,
            dead: record.dead,
            exitCode: record.exitCode,
            screen: record.buffer,
            truncated: record.truncated
        };
    }

    public sendKeys(sessionName: string, keys: string, options: { literal?: boolean } = {}): void {
        const record = this.requireSession(sessionName);
        record.pty.write(translateKeys(keys, options));
    }

    public resize(sessionName: string, cols: number, rows: number): void {
        const record = this.requireSession(sessionName);
        const normalizedCols = clampTerminalSize(cols, DEFAULT_COLS);
        const normalizedRows = clampTerminalSize(rows, DEFAULT_ROWS);
        if (record.cols === normalizedCols && record.rows === normalizedRows) {
            return;
        }
        record.cols = normalizedCols;
        record.rows = normalizedRows;
        record.pty.resize(normalizedCols, normalizedRows);
    }

    public killSession(sessionName: string): void {
        const record = this.sessions.get(sessionName);
        if (!record) {
            return;
        }
        try {
            record.pty.kill();
        } finally {
            record.dead = true;
            this.emit({
                sessionName: record.sessionName,
                paneId: record.paneId,
                connected: false,
                dead: true,
                exitCode: record.exitCode,
                screen: record.buffer,
                truncated: record.truncated,
                chunk: ''
            });
        }
    }

    public onDidSessionUpdate(listener: (event: PtySessionUpdate) => void): { dispose(): void } {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            }
        };
    }

    private emit(event: PtySessionUpdate): void {
        for (const listener of this.listeners) {
            listener({ ...event });
        }
    }

    private requireSession(sessionName: string): PtySessionRecord {
        const record = this.sessions.get(sessionName);
        if (!record) {
            throw new Error(`Terminal session '${sessionName}' is not active.`);
        }
        return record;
    }

    private resolveSessionName(requestedName: string | undefined, sessionPrefix: string | undefined): string {
        const baseName = requestedName?.trim() || `${sessionPrefix?.trim() || 'mission-agent'}-${randomUUID().slice(0, 8)}`;
        const existing = this.sessions.get(baseName);
        if (existing?.dead) {
            this.sessions.delete(baseName);
            return baseName;
        }
        if (!this.sessions.has(baseName)) {
            return baseName;
        }
        for (let suffix = 2; suffix < 10_000; suffix += 1) {
            const candidate = `${baseName}-${String(suffix)}`;
            if (!this.sessions.has(candidate)) {
                return candidate;
            }
        }
        throw new Error(`Unable to allocate a unique terminal session name for '${baseName}'.`);
    }
}

export class TerminalAgentTransport {
    private static registryBySpawn = new WeakMap<typeof spawnPty, PtySessionRegistry>();

    private readonly registry: PtySessionRegistry;

    public constructor(options: TerminalAgentTransportOptions = {}) {
        const spawnImpl = options.spawn ?? spawnPty;
        this.registry = TerminalAgentTransport.getOrCreateRegistry(spawnImpl, options.logLine);
    }

    public static onDidSessionUpdate(
        listener: (event: PtySessionUpdate) => void,
        options: { spawn?: typeof spawnPty } = {}
    ): { dispose(): void } {
        return TerminalAgentTransport.getOrCreateRegistry(options.spawn ?? spawnPty).onDidSessionUpdate(listener);
    }

    public async isAvailable(): Promise<{ available: boolean; detail?: string }> {
        return {
            available: true,
            detail: 'node-pty runtime is available.'
        };
    }

    public async openSession(request: TerminalOpenSessionRequest): Promise<TerminalSessionHandle> {
        return this.registry.openSession(request);
    }

    public async attachSession(
        sessionName: string,
        _options: { sharedSessionName?: string | undefined; paneId?: string | undefined } = {}
    ): Promise<TerminalSessionHandle | undefined> {
        return this.registry.attachSession(sessionName);
    }

    public async hasSession(sessionName: string): Promise<boolean> {
        return this.registry.hasSession(sessionName);
    }

    public async sendKeys(handle: TerminalSessionHandle, keys: string, options: { literal?: boolean } = {}): Promise<void> {
        this.registry.sendKeys(handle.sessionName, keys, options);
    }

    public async resizeSession(handle: TerminalSessionHandle, cols: number, rows: number): Promise<void> {
        this.registry.resize(handle.sessionName, cols, rows);
    }

    public async capturePane(handle: TerminalSessionHandle, _startLine = -200): Promise<string> {
        return this.registry.readSnapshot(handle.sessionName)?.screen ?? '';
    }

    public async readPaneState(handle: TerminalSessionHandle): Promise<{ dead: boolean; exitCode: number | null }> {
        const snapshot = this.registry.readSnapshot(handle.sessionName);
        if (!snapshot) {
            return {
                dead: true,
                exitCode: 1
            };
        }
        return {
            dead: snapshot.dead,
            exitCode: snapshot.exitCode
        };
    }

    public async readSnapshot(handle: TerminalSessionHandle): Promise<TerminalSessionSnapshot> {
        const snapshot = this.registry.readSnapshot(handle.sessionName);
        if (!snapshot) {
            return {
                sessionName: handle.sessionName,
                paneId: handle.paneId,
                connected: false,
                dead: true,
                exitCode: null,
                screen: '',
                truncated: false
            };
        }
        return snapshot;
    }

    public async killSession(handle: TerminalSessionHandle): Promise<void> {
        this.registry.killSession(handle.sessionName);
    }

    private static getOrCreateRegistry(
        spawnImpl: typeof spawnPty,
        logLine?: (line: string) => void
    ): PtySessionRegistry {
        const existing = this.registryBySpawn.get(spawnImpl);
        if (existing) {
            return existing;
        }
        const created = new PtySessionRegistry(spawnImpl, logLine);
        this.registryBySpawn.set(spawnImpl, created);
        return created;
    }
}

function buildPtyEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
    const merged: NodeJS.ProcessEnv = {
        ...process.env,
        ...(env ?? {}),
        TERM: 'xterm-256color'
    };
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) {
        if (typeof value === 'string') {
            output[key] = value;
        }
    }
    return output;
}

function resolvePtySpawnCommand(command: string, env: NodeJS.ProcessEnv): string {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
        throw new Error('PTY command is required.');
    }

    if (path.isAbsolute(trimmedCommand) || trimmedCommand.startsWith('.') || /[\\/]/u.test(trimmedCommand)) {
        return trimmedCommand;
    }

    const resolvedFromSearchPath = resolveExecutableFromSearchPath(trimmedCommand, env);
    if (resolvedFromSearchPath) {
        return resolvedFromSearchPath;
    }

    const knownShellPath = resolveKnownShellPath(trimmedCommand);
    if (knownShellPath) {
        return knownShellPath;
    }

    throw new Error(buildMissingExecutableMessage(trimmedCommand, env));
}

function resolvePtyLaunchCommand(command: string, args: string[], env: NodeJS.ProcessEnv): PtyLaunchCommand {
    const resolvedCommand = resolvePtySpawnCommand(command, env);
    const interpreterLaunch = resolveShebangLaunchCommand(resolvedCommand, args, env);
    if (interpreterLaunch) {
        return {
            ...interpreterLaunch,
            resolvedCommand
        };
    }

    return {
        command: resolvedCommand,
        args: [...args],
        resolvedCommand
    };
}

function resolveExecutableFromSearchPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
    for (const directory of collectSearchPathEntries(env, command)) {
        const candidate = path.join(directory, command);
        if (isExecutableFile(candidate)) {
            return candidate;
        }
        if (process.platform === 'win32') {
            for (const extension of collectWindowsExecutableExtensions(env)) {
                const candidateWithExtension = `${candidate}${extension}`;
                if (isExecutableFile(candidateWithExtension)) {
                    return candidateWithExtension;
                }
            }
        }
    }
    return undefined;
}

function collectSearchPathEntries(env: NodeJS.ProcessEnv, command: string): string[] {
    const pathKey = resolveProcessPathKey(env);
    const entries = new Set<string>();
    const pushEntry = (value: string | undefined): void => {
        const trimmedValue = value?.trim();
        if (trimmedValue) {
            entries.add(trimmedValue);
        }
    };

    for (const entry of (pathKey ? env[pathKey] : undefined)?.split(path.delimiter) ?? []) {
        pushEntry(entry);
    }

    if (process.platform !== 'win32') {
        for (const entry of DEFAULT_UNIX_PATH_SEGMENTS) {
            pushEntry(entry);
        }
    }

    const homeDirectory = env['HOME']?.trim() || os.homedir();
    if (homeDirectory) {
        pushEntry(path.join(homeDirectory, '.local', 'bin'));
        pushEntry(path.join(homeDirectory, '.cargo', 'bin'));
        pushEntry(path.join(homeDirectory, '.nvm', 'current', 'bin'));
        if (command === 'copilot') {
            pushEntry(path.join(homeDirectory, 'Library', 'Application Support', 'Code', COPILOT_CLI_DIRECTORY_SUFFIX));
            pushEntry(path.join(homeDirectory, 'Library', 'Application Support', 'Code - Insiders', COPILOT_CLI_DIRECTORY_SUFFIX));
        }
    }

    return [...entries];
}

function resolveProcessPathKey(env: NodeJS.ProcessEnv): string | undefined {
    if (process.platform === 'win32') {
        return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
    }

    return 'PATH';
}

function collectWindowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
    const configuredExtensions = env['PATHEXT']?.split(';') ?? ['.COM', '.EXE', '.BAT', '.CMD'];
    return configuredExtensions
        .map((extension) => extension.trim())
        .filter((extension) => extension.length > 0)
        .map((extension) => extension.startsWith('.') ? extension : `.${extension}`);
}

function resolveKnownShellPath(command: string): string | undefined {
    if (process.platform === 'win32') {
        if (command === 'powershell' || command === 'powershell.exe') {
            return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
        }
        return undefined;
    }

    const shellCandidates = new Map<string, string>([
        ['sh', '/bin/sh'],
        ['bash', '/bin/bash'],
        ['zsh', '/bin/zsh']
    ]);
    const candidate = shellCandidates.get(command);
    return candidate && isExecutableFile(candidate) ? candidate : undefined;
}

function resolveShebangLaunchCommand(
    resolvedCommand: string,
    args: string[],
    env: NodeJS.ProcessEnv
): Omit<PtyLaunchCommand, 'resolvedCommand'> | undefined {
    if (process.platform === 'win32' || !path.isAbsolute(resolvedCommand)) {
        return undefined;
    }

    const shebang = readShebangLine(resolvedCommand);
    if (!shebang) {
        return undefined;
    }

    const interpreter = resolveShebangInterpreter(shebang, env);
    if (!interpreter) {
        return undefined;
    }

    return {
        command: interpreter.command,
        args: [...interpreter.args, resolvedCommand, ...args]
    };
}

function readShebangLine(filePath: string): string | undefined {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const firstLine = content.split(/\r?\n/u, 1)[0]?.trim();
        if (!firstLine?.startsWith('#!')) {
            return undefined;
        }
        return firstLine.slice(2).trim();
    } catch {
        return undefined;
    }
}

function resolveShebangInterpreter(
    shebang: string,
    env: NodeJS.ProcessEnv
): { command: string; args: string[] } | undefined {
    const parts = shebang.split(/\s+/u).filter((part) => part.length > 0);
    const interpreter = parts[0];
    if (!interpreter) {
        return undefined;
    }

    if (interpreter === '/usr/bin/env') {
        const envTarget = parts.find((part, index) => index > 0 && !part.startsWith('-'));
        if (!envTarget) {
            return isExecutableFile(interpreter)
                ? { command: interpreter, args: parts.slice(1) }
                : undefined;
        }
        return {
            command: resolvePtySpawnCommand(envTarget, env),
            args: []
        };
    }

    return isExecutableFile(interpreter)
        ? {
            command: interpreter,
            args: parts.slice(1)
        }
        : undefined;
}

function isExecutableFile(candidatePath: string): boolean {
    try {
        fs.accessSync(candidatePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function buildMissingExecutableMessage(command: string, env: NodeJS.ProcessEnv): string {
    const pathKey = resolveProcessPathKey(env);
    const pathValue = pathKey ? env[pathKey]?.trim() : undefined;
    return pathValue
        ? `Unable to resolve executable '${command}' for PTY launch. ${pathKey}=${pathValue}`
        : `Unable to resolve executable '${command}' for PTY launch because no ${pathKey ?? 'PATH'} is configured.`;
}

function translateKeys(keys: string, options: { literal?: boolean }): string {
    if (options.literal) {
        return keys;
    }
    if (keys === 'Enter') {
        return '\r';
    }
    if (keys === 'C-c') {
        return '\x03';
    }
    if (keys === 'Backspace') {
        return '\x7f';
    }
    return keys;
}

function appendToBuffer(buffer: string, chunk: string): { buffer: string; truncated: boolean } {
    const next = `${buffer}${chunk}`;
    if (next.length <= MAX_BUFFER_SIZE) {
        return { buffer: next, truncated: false };
    }
    return {
        buffer: next.slice(next.length - MAX_BUFFER_SIZE),
        truncated: true
    };
}

function clampTerminalSize(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(1, Math.floor(value));
}
