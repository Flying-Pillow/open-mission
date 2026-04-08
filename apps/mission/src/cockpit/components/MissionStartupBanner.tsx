import readline from 'node:readline';
import { cockpitTheme } from './cockpitTheme.js';
import { missionOwlBrailleBanner } from '../banner/missionOwlBraille.js';
import { buildBrailleBannerLines } from '../banner/renderBrailleBanner.js';
import { banner } from '../banner/wordmark.js';

type BannerRole = 'text' | 'muted';

type BannerSegment = {
	text: string;
	role?: BannerRole;
	color?: string;
};

type BannerFrame = {
	duration: number;
	revealColumns: number;
};

const WORDMARK_LINES_RAW = banner.replace(/^\n+|\n+$/g, '').split('\n');

const WORDMARK_WIDTH = WORDMARK_LINES_RAW.reduce(
	(maxWidth, line) => Math.max(maxWidth, line.length),
	0
);

const WORDMARK_LINES = WORDMARK_LINES_RAW.map((line) => line.padEnd(WORDMARK_WIDTH, ' '));

const OWL_LINES = buildBrailleBannerLines(missionOwlBrailleBanner);
const OWL_WIDTH = OWL_LINES.reduce((maxWidth, line) => Math.max(maxWidth, lineWidth(line)), 0);
const BANNER_WIDTH = Math.max(OWL_WIDTH, WORDMARK_WIDTH);
const BANNER_STACK_GAP_LINES = 1;

const BANNER_FRAMES: BannerFrame[] = [
	{ duration: 90, revealColumns: 0 },
	{ duration: 90, revealColumns: Math.floor(WORDMARK_WIDTH * 0.3) },
	{ duration: 90, revealColumns: Math.floor(WORDMARK_WIDTH * 0.58) },
	{ duration: 90, revealColumns: Math.floor(WORDMARK_WIDTH * 0.82) },
	{ duration: 150, revealColumns: WORDMARK_WIDTH }
];

const BANNER_TEXT_COLOR = '#b388ff';

export function shouldShowMissionStartupBanner(): boolean {
	if (!process.stdout.isTTY) {
		return false;
	}
	if (process.env['CI']) {
		return false;
	}
	if (process.env['TERM'] === 'dumb') {
		return false;
	}
	if (process.env['MISSION_DISABLE_BANNER'] === '1') {
		return false;
	}
	return true;
}

export async function playMissionStartupBanner(): Promise<void> {
	if (!shouldShowMissionStartupBanner()) {
		return;
	}

	const output = process.stdout;
	const input = process.stdin;
	const previousRawMode = 'isRaw' in input ? input.isRaw : false;
	let skipRequested = false;

	const onData = () => {
		skipRequested = true;
	};

	if (input.isTTY) {
		input.resume();
		input.setRawMode?.(true);
		input.on('data', onData);
	}

	output.write('\x1b[?25l');

	try {
		for (const frame of BANNER_FRAMES) {
			renderBannerFrame(frame, output);
			await waitForFrameDuration(frame.duration, () => skipRequested);
			if (skipRequested) {
				break;
			}
		}
	} finally {
		if (input.isTTY) {
			input.off('data', onData);
			input.setRawMode?.(previousRawMode);
		}
		readline.cursorTo(output, 0, 0);
		readline.clearScreenDown(output);
		output.write('\x1b[0m\x1b[?25h');
	}
}

function renderBannerFrame(frame: BannerFrame, output: NodeJS.WriteStream): void {
	const bannerLines = buildBannerLines(frame);
	const bannerWidth = bannerLines.reduce((maxWidth, line) => Math.max(maxWidth, lineWidth(line)), 0);
	const bannerHeight = bannerLines.length;
	const terminalWidth = output.columns ?? bannerWidth;
	const terminalHeight = output.rows ?? bannerHeight;
	const leftPadding = ' '.repeat(Math.max(0, Math.floor((terminalWidth - bannerWidth) / 2)));
	const rightPadding = ' '.repeat(Math.max(0, terminalWidth - leftPadding.length - bannerWidth));
	const topPaddingCount = Math.max(0, Math.floor((terminalHeight - bannerHeight) / 2));
	const bottomPaddingCount = Math.max(0, terminalHeight - topPaddingCount - bannerHeight);
	const blankLine = `${leftPadding}${' '.repeat(Math.max(bannerWidth, 1))}${rightPadding}`;

	const lines: string[] = [];
	for (let index = 0; index < topPaddingCount; index += 1) {
		lines.push(`${colorizeBackground(blankLine)}${ANSI_RESET}`);
	}
	for (const line of bannerLines) {
		const visibleWidth = lineWidth(line);
		const lineRightPadding = ' '.repeat(Math.max(0, terminalWidth - leftPadding.length - visibleWidth));
		lines.push(`${colorizeBackground(leftPadding)}${renderBannerSegments(line)}${colorizeBackground(lineRightPadding)}${ANSI_RESET}`);
	}
	for (let index = 0; index < bottomPaddingCount; index += 1) {
		lines.push(`${colorizeBackground(blankLine)}${ANSI_RESET}`);
	}

	readline.cursorTo(output, 0, 0);
	readline.clearScreenDown(output);
	output.write(lines.join('\n'));
}

function buildBannerLines(frame: BannerFrame): BannerSegment[][] {
	const revealedWordmarkLines = WORDMARK_LINES.map((line) => line.slice(0, frame.revealColumns).padEnd(WORDMARK_WIDTH, ' '));
	const stackedLines: BannerSegment[][] = [];

	for (const owlLine of OWL_LINES) {
		stackedLines.push(centerBannerLine(owlLine, BANNER_WIDTH));
	}

	for (let index = 0; index < BANNER_STACK_GAP_LINES; index += 1) {
		stackedLines.push([{ text: ' '.repeat(BANNER_WIDTH) }]);
	}

	for (const wordmarkLine of revealedWordmarkLines) {
		stackedLines.push(centerBannerLine([{ text: wordmarkLine, role: 'text' }], BANNER_WIDTH));
	}

	return stackedLines;
}

function centerBannerLine(segments: BannerSegment[], targetWidth: number): BannerSegment[] {
	const contentWidth = lineWidth(segments);
	const leftPaddingWidth = Math.max(0, Math.floor((targetWidth - contentWidth) / 2));
	const rightPaddingWidth = Math.max(0, targetWidth - leftPaddingWidth - contentWidth);

	return [
		...(leftPaddingWidth > 0 ? [{ text: ' '.repeat(leftPaddingWidth) }] : []),
		...segments,
		...(rightPaddingWidth > 0 ? [{ text: ' '.repeat(rightPaddingWidth) }] : [])
	];
}

function bannerRoleColor(role: BannerRole): string {
	if (role === 'text') {
		return BANNER_TEXT_COLOR;
	}
	return cockpitTheme.mutedText;
}

function lineWidth(line: BannerSegment[]): number {
	return line.reduce((width, segment) => width + segment.text.length, 0);
}

function renderBannerSegments(segments: BannerSegment[]): string {
	return segments
		.map((segment) => {
			const color = segment.color ?? (segment.role ? bannerRoleColor(segment.role) : undefined);
			const prefix = `${ansiBackground(cockpitTheme.background)}${ANSI_DEFAULT_FOREGROUND}`;
			return color ? `${prefix}${ansiForeground(color)}${segment.text}` : `${prefix}${segment.text}`;
		})
		.join('');
}

function colorizeBackground(text: string): string {
	return `${ansiBackground(cockpitTheme.background)}${text}`;
}

function ansiForeground(hex: string): string {
	const { red, green, blue } = parseHexColor(hex);
	return `\x1b[38;2;${String(red)};${String(green)};${String(blue)}m`;
}

function ansiBackground(hex: string): string {
	const { red, green, blue } = parseHexColor(hex);
	return `\x1b[48;2;${String(red)};${String(green)};${String(blue)}m`;
}

function parseHexColor(hex: string): { red: number; green: number; blue: number } {
	const normalized = hex.replace(/^#/, '');
	const value = normalized.length === 3
		? normalized.split('').map((part) => `${part}${part}`).join('')
		: normalized;
	return {
		red: Number.parseInt(value.slice(0, 2), 16),
		green: Number.parseInt(value.slice(2, 4), 16),
		blue: Number.parseInt(value.slice(4, 6), 16)
	};
}

async function waitForFrameDuration(duration: number, shouldStop: () => boolean): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < duration) {
		if (shouldStop()) {
			return;
		}
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 16);
		});
	}
}

const ANSI_RESET = '\x1b[0m';
const ANSI_DEFAULT_FOREGROUND = '\x1b[39m';