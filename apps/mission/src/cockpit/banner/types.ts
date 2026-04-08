export type BrailleBannerColorName = 'lime' | 'purple' | 'empty';

export type BrailleBannerCell = {
	char: string;
	type: 'braille';
	color: BrailleBannerColorName;
};

export type BrailleBannerDefinition = {
	description: string;
	palette: Record<BrailleBannerColorName, string>;
	grid: BrailleBannerCell[][];
};

export type ColoredBannerSegment = {
	text: string;
	color?: string;
};