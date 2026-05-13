import { FitAddon, Ghostty, Terminal } from "ghostty-web";
import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

export type AppTerminal = Terminal;
export type AppTerminalResizeEvent = { cols: number; rows: number };

export type AppTerminalRuntime = {
    terminal: AppTerminal;
    fit: () => void;
    dispose: () => void;
};

type CreateAppTerminalRuntimeInput = {
    target: HTMLElement;
    isDisposed: () => boolean;
    onData?: (data: string) => void;
    onResize?: (event: AppTerminalResizeEvent) => void;
    cols?: number;
    rows?: number;
    autoFit?: boolean;
    cursorBlink?: boolean;
    disableStdin?: boolean;
};

let ghosttyPromise: Promise<Ghostty> | null = null;

export async function createAppTerminalRuntime(
    input: CreateAppTerminalRuntimeInput,
): Promise<AppTerminalRuntime | null> {
    const ghostty = await loadGhostty();
    if (input.isDisposed()) {
        return null;
    }

    const terminal = new Terminal({
        ghostty,
        cols: input.cols,
        rows: input.rows,
        convertEol: false,
        cursorBlink: input.cursorBlink ?? true,
        disableStdin: input.disableStdin ?? false,
        fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
        fontSize: 13,
        scrollback: 1500,
        theme: {
            background: "#000000",
            foreground: "#e2e8f0",
            cursor: "#f8fafc",
            selectionBackground: "#334155",
            black: "#020617",
            red: "#f87171",
            green: "#4ade80",
            yellow: "#facc15",
            blue: "#60a5fa",
            magenta: "#f472b6",
            cyan: "#22d3ee",
            white: "#e2e8f0",
            brightBlack: "#475569",
            brightRed: "#fb7185",
            brightGreen: "#86efac",
            brightYellow: "#fde047",
            brightBlue: "#93c5fd",
            brightMagenta: "#f9a8d4",
            brightCyan: "#67e8f9",
            brightWhite: "#f8fafc",
        },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(input.target);

    const dataSubscription = terminal.onData(input.onData ?? (() => { }));
    const resizeSubscription = terminal.onResize(input.onResize ?? (() => { }));

    if (input.autoFit ?? true) {
        fitAddon.fit();
        fitAddon.observeResize();
    }

    if (input.isDisposed()) {
        dataSubscription.dispose();
        resizeSubscription.dispose();
        terminal.dispose();
        return null;
    }

    return {
        terminal,
        fit: () => fitAddon.fit(),
        dispose: () => {
            dataSubscription.dispose();
            resizeSubscription.dispose();
            terminal.dispose();
        },
    };
}

function loadGhostty(): Promise<Ghostty> {
    ghosttyPromise ??= Ghostty.load(ghosttyWasmUrl);
    return ghosttyPromise;
}
