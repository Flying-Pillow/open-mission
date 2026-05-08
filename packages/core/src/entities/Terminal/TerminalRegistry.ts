import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn as spawnPty, type IPty } from 'node-pty';
import { createPlainTerminalScreen, type TerminalScreen } from '../../daemon/runtime/terminal/TerminalScreen.js';

export type TerminalHandle = {
    terminalName: string;
    terminalPaneId: string;
    sharedTerminalName?: string | undefined;
};

export type TerminalLease = {
    pid: number;
    processGroupId?: number | undefined;
    command: string;
    args: string[];
    workingDirectory: string;
    startedAt: string;
};

export type TerminalOwner =
    | { kind: 'mission'; missionId: string }
    | { kind: 'task'; missionId?: string; taskId: string }
    | { kind: 'agent-execution'; ownerId: string; agentExecutionId: string }
    | { kind: 'repository'; repositoryRootPath: string }
    | { kind: 'system'; label?: string };

export type ProcessController = {
    isProcessRunning(processId: number): boolean;
    killProcess(processId: number, signal: NodeJS.Signals): void;
    killProcessGroup(processGroupId: number, signal: NodeJS.Signals): void;
};

export type TerminalOpenRequest = {
    workingDirectory: string;
    command: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
    terminalPrefix?: string;
    terminalName?: string;
    sharedTerminalName?: string;
    owner?: TerminalOwner;
};

export type TerminalSnapshot = {
    terminalName: string;
    terminalPaneId: string;
    connected: boolean;
    dead: boolean;
    exitCode: number | null;
    cols?: number;
    rows?: number;
    screen: string;
    truncated: boolean;
    chunk?: string;
    sharedTerminalName?: string;
    workingDirectory?: string;
    processLease?: TerminalLease;
    owner?: TerminalOwner;
};

export type TerminalUpdate = TerminalSnapshot & {
    chunk: string;
};

export type TerminalRecordingUpdate = {
    terminalName: string;
    terminalPaneId: string;
    owner?: TerminalOwner;
    event:
    | { type: 'input'; at: string; data: string; literal?: boolean }
    | { type: 'resize'; at: string; cols: number; rows: number };
};

export type TerminalState = {
    dead: boolean;
    exitCode: number | null;
};

export type TerminalScreenFactory = (input: {
    cols: number;
    rows: number;
    maxBufferSize: number;
}) => TerminalScreen;

export type TerminalRegistryOptions = {
    spawnImpl: typeof spawnPty;
    logLine?: (line: string) => void;
    processController?: ProcessController;
    terminationGraceMs?: number;
    terminationPollIntervalMs?: number;
    screenFactory?: TerminalScreenFactory;
};

type LiveTerminalOptions = {
    terminalName: string;
    terminalPaneId: string;
    pty: IPty;
    workingDirectory: string;
    screen: TerminalScreen;
    cols: number;
    rows: number;
    processLease: TerminalLease;
    owner?: TerminalOwner;
};

class LiveTerminal {
    public readonly terminalName: string;
    public readonly terminalPaneId: string;
    public readonly pty: IPty;
    public readonly workingDirectory: string;
    public readonly screen: TerminalScreen;
    public readonly processLease: TerminalLease;
    public readonly owner?: TerminalOwner;

    private dead = false;
    private exitCode: number | null = null;
    private cols: number;
    private rows: number;

    public constructor(options: LiveTerminalOptions) {
        this.terminalName = options.terminalName;
        this.terminalPaneId = options.terminalPaneId;
        this.pty = options.pty;
        this.workingDirectory = options.workingDirectory;
        this.screen = options.screen;
        this.cols = options.cols;
        this.rows = options.rows;
        this.processLease = { ...options.processLease };
        if (options.owner) {
            this.owner = cloneTerminalOwner(options.owner);
        }
    }

    public get isDead(): boolean {
        return this.dead;
    }

    public get state(): TerminalState {
        return {
            dead: this.dead,
            exitCode: this.exitCode
        };
    }

    public handle(): TerminalHandle {
        return {
            terminalName: this.terminalName,
            terminalPaneId: this.terminalPaneId
        };
    }

    public write(chunk: string): TerminalUpdate {
        this.screen.write(chunk);
        return {
            ...this.snapshot(),
            chunk
        };
    }

    public markExited(exitCode: number): TerminalUpdate {
        this.dead = true;
        this.exitCode = exitCode;
        return {
            ...this.snapshot(),
            chunk: ''
        };
    }

    public sendKeys(keys: string): void {
        this.pty.write(keys);
    }

    public resize(cols: number, rows: number): boolean {
        if (this.cols === cols && this.rows === rows) {
            return false;
        }
        this.cols = cols;
        this.rows = rows;
        this.screen.resize(cols, rows);
        this.pty.resize(cols, rows);
        return true;
    }

    public snapshot(): TerminalSnapshot {
        const screen = this.screen.snapshot();
        return {
            terminalName: this.terminalName,
            terminalPaneId: this.terminalPaneId,
            connected: true,
            dead: this.dead,
            exitCode: this.exitCode,
            cols: this.cols,
            rows: this.rows,
            screen: screen.screen,
            truncated: screen.truncated,
            workingDirectory: this.workingDirectory,
            processLease: { ...this.processLease },
            ...(this.owner ? { owner: cloneTerminalOwner(this.owner) } : {})
        };
    }
}

function cloneTerminalOwner(owner: TerminalOwner): TerminalOwner {
    return { ...owner };
}

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

export type SharedTerminalRegistryOptions = Omit<TerminalRegistryOptions, 'spawnImpl'> & {
    spawn?: typeof spawnPty;
};

export class TerminalRegistry {
    private static readonly sharedBySpawn = new WeakMap<typeof spawnPty, TerminalRegistry>();

    private readonly terminals = new Map<string, LiveTerminal>();
    private readonly listeners = new Set<(event: TerminalUpdate) => void>();
    private readonly recordingListeners = new Set<(event: TerminalRecordingUpdate) => void>();

    public constructor(private readonly options: TerminalRegistryOptions) { }

    public static shared(options: SharedTerminalRegistryOptions = {}): TerminalRegistry {
        const spawnImpl = options.spawn ?? spawnPty;
        const existing = this.sharedBySpawn.get(spawnImpl);
        if (existing) {
            return existing;
        }

        const created = new TerminalRegistry({
            spawnImpl,
            ...(options.logLine ? { logLine: options.logLine } : {}),
            ...(options.processController ? { processController: options.processController } : {}),
            ...(options.terminationGraceMs !== undefined ? { terminationGraceMs: options.terminationGraceMs } : {}),
            ...(options.terminationPollIntervalMs !== undefined ? { terminationPollIntervalMs: options.terminationPollIntervalMs } : {}),
            ...(options.screenFactory ? { screenFactory: options.screenFactory } : {})
        });
        this.sharedBySpawn.set(spawnImpl, created);
        return created;
    }

    public openTerminal(request: TerminalOpenRequest): TerminalHandle {
        const terminalName = this.resolveTerminalName(request.terminalName, request.terminalPrefix);
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

        const terminal = new LiveTerminal({
            terminalName,
            terminalPaneId: PTY_PANE_ID,
            pty,
            workingDirectory: request.workingDirectory,
            screen: this.createScreen(DEFAULT_COLS, DEFAULT_ROWS),
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            processLease: createProcessLease({
                pty,
                launchCommand,
                workingDirectory: request.workingDirectory
            }),
            ...(request.owner ? { owner: cloneTerminalOwner(request.owner) } : {})
        });
        this.terminals.set(terminalName, terminal);

        pty.onData((chunk) => {
            this.emit(terminal.write(chunk));
        });

        pty.onExit(({ exitCode }) => {
            this.emit(terminal.markExited(exitCode));
        });

        return terminal.handle();
    }

    public attachTerminal(terminalName: string): TerminalHandle | undefined {
        const terminal = this.terminals.get(terminalName);
        if (!terminal) {
            return undefined;
        }
        return terminal.handle();
    }

    public hasTerminal(terminalName: string): boolean {
        return this.terminals.has(terminalName);
    }

    public readSnapshot(terminalName: string): TerminalSnapshot | undefined {
        const terminal = this.terminals.get(terminalName);
        return terminal?.snapshot();
    }

    public sendKeys(terminalName: string, keys: string, options: { literal?: boolean } = {}): void {
        const terminal = this.requireTerminal(terminalName);
        const data = translateKeys(keys, options);
        terminal.sendKeys(data);
        this.emitRecording({
            terminalName: terminal.terminalName,
            terminalPaneId: terminal.terminalPaneId,
            ...(terminal.owner ? { owner: cloneTerminalOwner(terminal.owner) } : {}),
            event: {
                type: 'input',
                at: new Date().toISOString(),
                data,
                ...(options.literal !== undefined ? { literal: options.literal } : {})
            }
        });
    }

    public resize(terminalName: string, cols: number, rows: number): void {
        const terminal = this.requireTerminal(terminalName);
        const normalizedCols = clampTerminalSize(cols, DEFAULT_COLS);
        const normalizedRows = clampTerminalSize(rows, DEFAULT_ROWS);
        if (!terminal.resize(normalizedCols, normalizedRows)) {
            return;
        }
        this.emitRecording({
            terminalName: terminal.terminalName,
            terminalPaneId: terminal.terminalPaneId,
            ...(terminal.owner ? { owner: cloneTerminalOwner(terminal.owner) } : {}),
            event: {
                type: 'resize',
                at: new Date().toISOString(),
                cols: normalizedCols,
                rows: normalizedRows
            }
        });
    }

    public async killTerminal(terminalName: string): Promise<TerminalState> {
        const terminal = this.terminals.get(terminalName);
        if (!terminal) {
            return { dead: true, exitCode: null };
        }
        if (terminal.isDead) {
            return terminal.state;
        }
        await this.terminateTerminal(terminal);
        return terminal.state;
    }

    public onDidTerminalUpdate(listener: (event: TerminalUpdate) => void): { dispose(): void } {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            }
        };
    }

    public onDidTerminalRecordingUpdate(listener: (event: TerminalRecordingUpdate) => void): { dispose(): void } {
        this.recordingListeners.add(listener);
        return {
            dispose: () => {
                this.recordingListeners.delete(listener);
            }
        };
    }

    public async dispose(): Promise<void> {
        await Promise.all([...this.terminals.values()].map((terminal) => this.terminateTerminal(terminal)));
        this.terminals.clear();
        this.listeners.clear();
        this.recordingListeners.clear();
    }

    private emit(event: TerminalUpdate): void {
        for (const listener of this.listeners) {
            listener({ ...event });
        }
    }

    private emitRecording(event: TerminalRecordingUpdate): void {
        for (const listener of this.recordingListeners) {
            listener({
                ...event,
                ...(event.owner ? { owner: cloneTerminalOwner(event.owner) } : {}),
                event: { ...event.event }
            });
        }
    }

    private requireTerminal(terminalName: string): LiveTerminal {
        const terminal = this.terminals.get(terminalName);
        if (!terminal) {
            throw new Error(`Terminal '${terminalName}' is not active.`);
        }
        return terminal;
    }

    private resolveTerminalName(requestedName: string | undefined, terminalPrefix: string | undefined): string {
        const baseName = requestedName?.trim() || `${terminalPrefix?.trim() || 'mission-terminal'}-${randomUUID().slice(0, 8)}`;
        const existing = this.terminals.get(baseName);
        if (existing?.isDead) {
            this.terminals.delete(baseName);
            return baseName;
        }
        if (!this.terminals.has(baseName)) {
            return baseName;
        }
        for (let suffix = 2; suffix < 10_000; suffix += 1) {
            const candidate = `${baseName}-${String(suffix)}`;
            if (!this.terminals.has(candidate)) {
                return candidate;
            }
        }
        throw new Error(`Unable to allocate a unique terminal name for '${baseName}'.`);
    }

    private async terminateTerminal(terminal: LiveTerminal): Promise<void> {
        this.killPty(terminal, 'SIGTERM');
        this.killProcessGroup(terminal, 'SIGTERM');
        if (await this.waitForExit(terminal, this.terminationGraceMs)) {
            return;
        }

        this.killPty(terminal, 'SIGKILL');
        this.killProcessGroup(terminal, 'SIGKILL');
        await this.waitForExit(terminal, this.terminationGraceMs);
    }

    private killPty(terminal: LiveTerminal, signal: NodeJS.Signals): void {
        try {
            terminal.pty.kill(signal);
        } catch {
            try {
                terminal.pty.kill();
            } catch {
                // Termination continues through the process lease when PTY kill fails.
            }
        }
    }

    private killProcessGroup(terminal: LiveTerminal, signal: NodeJS.Signals): void {
        const processGroupId = terminal.processLease.processGroupId;
        if (!processGroupId || process.platform === 'win32') {
            return;
        }
        try {
            this.processController.killProcessGroup(processGroupId, signal);
        } catch {
            if (terminal.processLease.pid > 1 && terminal.processLease.pid !== process.pid) {
                try {
                    this.processController.killProcess(terminal.processLease.pid, signal);
                } catch {
                    // Best effort; waitForExit reports the final truth.
                }
            }
        }
    }

    private async waitForExit(terminal: LiveTerminal, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + Math.max(0, timeoutMs);
        while (!terminal.isDead && Date.now() <= deadline) {
            await delay(this.terminationPollIntervalMs);
        }
        return terminal.isDead;
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

    private get processController(): ProcessController {
        return this.options.processController ?? defaultProcessController;
    }
}

export const defaultProcessController: ProcessController = {
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
}): TerminalLease {
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
        ? { command: interpreter, args: parts.slice(1) }
        : undefined;
}

function isExecutableFile(filePath: string): boolean {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            return false;
        }
        if (process.platform === 'win32') {
            return true;
        }
        return (stat.mode & 0o111) !== 0;
    } catch {
        return false;
    }
}

function buildMissingExecutableMessage(command: string, env: NodeJS.ProcessEnv): string {
    const pathKey = resolveProcessPathKey(env);
    const searchPath = pathKey ? env[pathKey] : undefined;
    return `Unable to resolve PTY command '${command}'. Search PATH: ${searchPath || '(empty)'}.`;
}

function clampTerminalSize(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(1, Math.floor(value));
}

function translateKeys(keys: string, options: { literal?: boolean }): string {
    if (options.literal) {
        return keys;
    }
    switch (keys) {
        case 'Enter':
            return '\r';
        case 'Tab':
            return '\t';
        case 'Backspace':
            return '\x7f';
        case 'Escape':
            return '\x1b';
        case 'C-c':
        case 'Ctrl+C':
            return '\x03';
        case 'C-d':
        case 'Ctrl+D':
            return '\x04';
        case 'Up':
            return '\x1b[A';
        case 'Down':
            return '\x1b[B';
        case 'Right':
            return '\x1b[C';
        case 'Left':
            return '\x1b[D';
        default:
            return keys;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}