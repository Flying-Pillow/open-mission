const TERMINAL_ALT_SCREEN_PATTERN = /\u001b\[\?(?:47|1047|1048|1049)[hl]/gu;
const TERMINAL_OSC_SEQUENCE_PATTERN = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu;
const TERMINAL_ESCAPE_SEQUENCE_PATTERN = /\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/gu;
const TERMINAL_SGR_SEQUENCE_PATTERN = /^\u001b\[[0-9;]*m$/u;
const TERMINAL_CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f]+/gu;
const TERMINAL_SURFACE_CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]+/gu;

export function stripTerminalOscSequences(value: string): string {
    return value.replace(TERMINAL_OSC_SEQUENCE_PATTERN, '');
}

export function stripTerminalAlternateScreenSequences(value: string): string {
    return value.replace(TERMINAL_ALT_SCREEN_PATTERN, '');
}

export function sanitizeTerminalScreenForSurface(screen: string): string {
    return sanitizeTerminalTextForSurface(stripTerminalAlternateScreenSequences(screen));
}

export function sanitizeTerminalOutputChunkForSurface(chunk: string): string {
    return sanitizeTerminalTextForSurface(chunk);
}

export function sanitizeTerminalTextForSurface(value: string): string {
    return stripTerminalAlternateScreenSequences(stripTerminalOscSequences(value))
        .replace(TERMINAL_SURFACE_CONTROL_CHAR_PATTERN, '');
}

export function sanitizeTerminalTextForHeuristics(line: string): string | null {
    const withoutOsc = stripTerminalOscSequences(line);
    const escapeSequences = withoutOsc.match(TERMINAL_ESCAPE_SEQUENCE_PATTERN) ?? [];
    if (escapeSequences.some((sequence) => !TERMINAL_SGR_SEQUENCE_PATTERN.test(sequence))) {
        return null;
    }
    const normalized = withoutOsc
        .replace(TERMINAL_ESCAPE_SEQUENCE_PATTERN, ' ')
        .replace(TERMINAL_CONTROL_CHAR_PATTERN, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    return normalized.length > 0 ? normalized : null;
}