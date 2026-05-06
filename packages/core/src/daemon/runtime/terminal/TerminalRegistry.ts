import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPty } from 'node-pty';
import {
    cloneTerminalSessionOwner,
    type TerminalOpenSessionRequest,
    type TerminalProcessController,
    type TerminalProcessLease,
    type TerminalRegistryOptions,
    type TerminalSessionHandle,
    type TerminalSessionOwner,
    type TerminalSessionSnapshot,
    type TerminalSessionState,
    type TerminalSessionUpdate
} from './Terminal.js';
import { createPlainTerminalScreen, type TerminalScreen } from './TerminalScreen.js';

type PtySessionRecord = {
    sessionName: string;
    paneId: string;
    pty: IPty;
    workingDirectory: string;
    screen: TerminalScreen;
    dead: boolean;
    exitCode: number | null;
    cols: number;
    rows: number;
    processLease: TerminalProcessLease;
    owner?: TerminalSessionOwner;
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
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_TERMINATION_POLL_INTERVAL_MS = 50;
const DEFAULT_UNIX_PATH_SEGMENTS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
const COPILOT_CLI_DIRECTORY_SUFFIX = path.join('User', 'globalStorage', 'github.copilot-chat', 'copilotCli');

export class TerminalRegistry {
    private readonly sessions = new Map<string, PtySessionRecord>();
    private readonly listeners = new Set<(event: TerminalSessionUpdate) => void>();

    public constructor(private readonly options: TerminalRegistryOptions) { }

    public openSession(request: TerminalOpenSessionRequest): TerminalSessionHandle {
        const sessionName = this.resolveSessionName(request.sessionName, request.sessionPrefix);
        const command = request.command.trim();
        if (!command) {
            throw new Error('TerminalRegistry requires a command.');
        }

        const env = buildPtyEnv(request.env);
        const launchCommand = resolvePtyLaunchCommand(command, request.args ?? [], env);

        let pty: IPty;
        try {
            pty = this.options.spawnImpl(launchCommand.command, launchCommand.args, {
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
        this.options.logLine?.(`pty spawn ${launchCommand.command} ${launchCommand.args.join(' ')}`.trim());

        const record: PtySessionRecord = {
            sessionName,
            paneId: PTY_PANE_ID,
            pty,
            workingDirectory: request.workingDirectory,
            screen: this.createScreen(DEFAULT_COLS, DEFAULT_ROWS),
            dead: false,
            exitCode: null,
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            processLease: createProcessLease({
                pty,
                launchCommand,
                workingDirectory: request.workingDirectory
            }),
            ...(request.owner ? { owner: cloneTerminalSessionOwner(request.owner) } : {})
        };
        this.sessions.set(sessionName, record);

        pty.onData((chunk) => {
            record.screen.write(chunk);
            this.emit({
                ...this.createSnapshot(record),
                chunk
            });
        });

        pty.onExit(({ exitCode }) => {
            record.dead = true;
            record.exitCode = exitCode;
            this.emit({
                ...this.createSnapshot(record),
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
        return record ? this.createSnapshot(record) : undefined;
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
        record.screen.resize(normalizedCols, normalizedRows);
        record.pty.resize(normalizedCols, normalizedRows);
    }

    public async killSession(sessionName: string): Promise<TerminalSessionState> {
        const record = this.sessions.get(sessionName);
        if (!record) {
            return { dead: true, exitCode: null };
        }
        if (record.dead) {
            return { dead: true, exitCode: record.exitCode };
        }
        await this.terminateRecord(record);
        return { dead: record.dead, exitCode: record.exitCode };
    }

    public onDidSessionUpdate(listener: (event: TerminalSessionUpdate) => void): { dispose(): void } {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            }
        };
    }

    private emit(event: TerminalSessionUpdate): void {
        for (const listener of this.listeners) {
            listener({ ...event });
        }
    }

    private createSnapshot(record: PtySessionRecord): TerminalSessionSnapshot {
        const screen = record.screen.snapshot();
        return {
            sessionName: record.sessionName,
            paneId: record.paneId,
            connected: true,
            dead: record.dead,
            exitCode: record.exitCode,
            screen: screen.screen,
            truncated: screen.truncated,
            workingDirectory: record.workingDirectory,
            processLease: { ...record.processLease },
            ...(record.owner ? { owner: cloneTerminalSessionOwner(record.owner) } : {})
        };
    }

    private requireSession(sessionName: string): PtySessionRecord {
        const record = this.sessions.get(sessionName);
        if (!record) {
            throw new Error(`Terminal session '${sessionName}' is not active.`);
        }
        return record;
    }

    private resolveSessionName(requestedName: string | undefined, sessionPrefix: string | undefined): string {
        const baseName = requestedName?.trim() || `${sessionPrefix?.trim() || 'mission-terminal'}-${randomUUID().slice(0, 8)}`;
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

    private async terminateRecord(record: PtySessionRecord): Promise<void> {
        this.killPty(record, 'SIGTERM');
        this.killProcessGroup(record, 'SIGTERM');
        if (await this.waitForExit(record, this.terminationGraceMs)) {
            return;
        }

        this.killPty(record, 'SIGKILL');
        this.killProcessGroup(record, 'SIGKILL');
        await this.waitForExit(record, this.terminationGraceMs);
    }

    private killPty(record: PtySessionRecord, signal: NodeJS.Signals): void {
        try {
            record.pty.kill(signal);
        } catch {
            try {
                record.pty.kill();
            } catch {
                // Termination continues through the process lease when PTY kill fails.
            }
        }
    }

    private killProcessGroup(record: PtySessionRecord, signal: NodeJS.Signals): void {
        const processGroupId = record.processLease.processGroupId;
        if (!processGroupId || process.platform === 'win32') {
            return;
        }
        try {
            this.processController.killProcessGroup(processGroupId, signal);
        } catch {
            if (record.processLease.pid > 1 && record.processLease.pid !== process.pid) {
                try {
                    this.processController.killProcess(record.processLease.pid, signal);
                } catch {
                    // Best effort; waitForExit reports the final truth.
                }
            }
        }
    }

    private async waitForExit(record: PtySessionRecord, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + Math.max(0, timeoutMs);
        while (!record.dead && Date.now() <= deadline) {
            await delay(this.terminationPollIntervalMs);
        }
        return record.dead;
    }

    private createScreen(cols: number, rows: number): TerminalScreen {
        return (this.options.screenFactory ?? createPlainTerminalScreen)({
            cols,
            rows,
            maxBufferSize: MAX_BUFFER_SIZE
        });
    }

    private get terminationGraceMs(): number {
        return Math.max(0, this.options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
    }

    private get terminationPollIntervalMs(): number {
        return Math.max(1, this.options.terminationPollIntervalMs ?? DEFAULT_TERMINATION_POLL_INTERVAL_MS);
    }

    private get processController(): TerminalProcessController {
        return this.options.processController ?? defaultTerminalProcessController;
    }
}

export const defaultTerminalProcessController: TerminalProcessController = {
    isProcessRunning(processId) {
        if (!Number.isInteger(processId) || processId <= 0) {
            return false;
        }
        try {
            process.kill(processId, 0);
            return true;
        } catch {
            return false;
        }
    },
    killProcess(processId, signal) {
        if (!Number.isInteger(processId) || processId <= 1 || processId === process.pid) {
            return;
        }
        process.kill(processId, signal);
    },
    killProcessGroup(processGroupId, signal) {
        if (!Number.isInteger(processGroupId) || processGroupId <= 1 || processGroupId === process.pid) {
            return;
        }
        process.kill(-processGroupId, signal);
    }
};

function createProcessLease(input: {
    pty: IPty;
    launchCommand: PtyLaunchCommand;
    workingDirectory: string;
}): TerminalProcessLease {
    const pid = Number.isInteger(input.pty.pid) && input.pty.pid > 0 ? input.pty.pid : 0;
    return {
        pid,
        ...(pid > 0 && process.platform !== 'win32' ? { processGroupId: pid } : {}),
        command: input.launchCommand.command,
        args: [...input.launchCommand.args],
        workingDirectory: input.workingDirectory,
        startedAt: new Date().toISOString()
    };
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

function clampTerminalSize(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(1, Math.floor(value));
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
