import type { BrailleBannerCell, BrailleBannerDefinition, ColoredBannerSegment } from './types.js';

export function buildBrailleBannerLines(definition: BrailleBannerDefinition): ColoredBannerSegment[][] {
	return definition.grid.map((row) => collapseRowSegments(row, definition));
}

function collapseRowSegments(
	row: BrailleBannerCell[],
	definition: BrailleBannerDefinition
): ColoredBannerSegment[] {
	const segments: ColoredBannerSegment[] = [];

	for (const cell of row) {
		const color = cell.color === 'empty' ? undefined : definition.palette[cell.color];
		const text = cell.color === 'empty' ? ' ' : cell.char;
		const previousSegment = segments.at(-1);

		if (previousSegment && previousSegment.color === color) {
			previousSegment.text += text;
			continue;
		}

		segments.push(color ? { text, color } : { text });
	}

	return segments;
}