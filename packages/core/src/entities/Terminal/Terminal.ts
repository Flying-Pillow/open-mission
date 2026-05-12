import { Entity, createEntityId, type EntityExecutionContext } from '../Entity/Entity.js';
import { TerminalRegistry, type TerminalHandle, type TerminalSnapshot as RegistryTerminalSnapshot } from './TerminalRegistry.js';
import {
    terminalEntityName,
    TerminalInputSchema,
    TerminalLocatorSchema,
    TerminalSchema,
    type TerminalInputType,
    type TerminalType
} from './TerminalSchema.js';

export class Terminal extends Entity<TerminalType, string> {
    public static override readonly entityName = terminalEntityName;

    public static createEntityId(terminalName: string): string {
        return createEntityId('terminal', terminalName.trim());
    }

    public static read(payload: unknown, _context?: EntityExecutionContext): TerminalType {
        const input = TerminalLocatorSchema.parse(payload);
        const registry = TerminalRegistry.shared();
        const handle = registry.attachTerminal(input.terminalName);
        if (!handle) {
            return createDisconnectedTerminalSnapshot(input.terminalName, input.terminalPaneId ?? input.terminalName);
        }
        return createTerminalEntitySnapshot(
            registry.readSnapshot(handle.terminalName) ?? createDeadRegistryTerminalSnapshot(handle)
        );
    }

    public static sendInput(payload: unknown, context?: EntityExecutionContext): TerminalType {
        const input = TerminalInputSchema.parse(payload);
        const registry = TerminalRegistry.shared();
        const handle = registry.attachTerminal(input.terminalName);
        if (handle) {
            sendTerminalInput(registry, handle.terminalName, input);
        }
        return Terminal.read({
            terminalName: input.terminalName,
            terminalPaneId: input.terminalPaneId
        }, context);
    }

    public constructor(snapshot: TerminalType) {
        super(TerminalSchema.parse(snapshot));
    }

    public get id(): string {
        return Terminal.createEntityId(this.data.terminalName);
    }
}

function sendTerminalInput(registry: TerminalRegistry, terminalName: string, input: TerminalInputType): void {
    const isKeyboardInput = typeof input.data === 'string' && input.data.length > 0;
    const isResize = input.cols !== undefined && input.rows !== undefined;
    if (isKeyboardInput) {
        registry.sendKeys(terminalName, input.data!, {
            ...(input.literal !== undefined ? { literal: input.literal } : {})
        });
    }
    if (isResize) {
        registry.resize(terminalName, input.cols!, input.rows!);
    }
}

function createTerminalEntitySnapshot(snapshot: RegistryTerminalSnapshot): TerminalType {
    return TerminalSchema.parse({
        terminalName: snapshot.terminalName,
        terminalPaneId: snapshot.terminalPaneId,
        connected: snapshot.connected,
        dead: snapshot.dead,
        exitCode: snapshot.exitCode,
        ...(snapshot.cols ? { cols: snapshot.cols } : {}),
        ...(snapshot.rows ? { rows: snapshot.rows } : {}),
        screen: snapshot.screen,
        ...(typeof snapshot.chunk === 'string' ? { chunk: snapshot.chunk } : {}),
        ...(snapshot.truncated ? { truncated: true } : {}),
        ...(snapshot.sharedTerminalName ? { sharedTerminalName: snapshot.sharedTerminalName } : {}),
        ...(snapshot.workingDirectory ? { workingDirectory: snapshot.workingDirectory } : {}),
        ...(snapshot.owner ? { owner: snapshot.owner } : {})
    });
}

function createDisconnectedTerminalSnapshot(terminalName: string, terminalPaneId: string): TerminalType {
    return TerminalSchema.parse({
        terminalName,
        terminalPaneId,
        connected: false,
        dead: true,
        exitCode: null,
        screen: ''
    });
}

function createDeadRegistryTerminalSnapshot(handle: TerminalHandle): RegistryTerminalSnapshot {
    return {
        terminalName: handle.terminalName,
        terminalPaneId: handle.terminalPaneId,
        connected: false,
        dead: true,
        exitCode: null,
        screen: '',
        truncated: false,
        ...(handle.sharedTerminalName ? { sharedTerminalName: handle.sharedTerminalName } : {})
    };
}