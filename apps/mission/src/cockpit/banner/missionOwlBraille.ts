import type { BrailleBannerCell, BrailleBannerDefinition } from './types.js';

const OWL_COLOR_ROWS = [
	'.L.........................L.',
	'.LLL.....................LLL.',
	'LLLLPP.................PPLLLL',
	'.LLLPPPP...L.....L...PPPPLLL.',
	'.LLLPPPPP..LLLLLLL..PPPPPLLL.',
	'.LLLPPPPPP.LLLLLLL.PPPPPPLLL.',
	'..LLLPPPPPPLLPLPLLPPPPPPLLL..',
	'...LLLLPPPPLLLLLLLPPPPLLLL...',
	'....LLLLPPPLLLLLLLPPPLLLL....',
	'......LLLLPLLLLLLLPLLLL......',
	'........LL.LLLLLLL.LL........',
	'............LLLLL............',
	'.............LLL.............',
	'............PPLPP............',
	'............PPPPP............',
	'..............P..............',
] as const;

function rowToCells(pattern: string): BrailleBannerCell[] {
	return Array.from(pattern, (symbol) => {
		if (symbol === 'L') {
			return { char: '⣿', type: 'braille' as const, color: 'lime' as const };
		}
		if (symbol === 'P') {
			return { char: '⣿', type: 'braille' as const, color: 'purple' as const };
		}
		return { char: '⠀', type: 'braille' as const, color: 'empty' as const };
	});
}

export const missionOwlBrailleBanner: BrailleBannerDefinition = {
	description: 'Mission cockpit braille owl (generated from owl_base.png)',
	palette: {
		lime: '#84E119',
		purple: '#9B4EE8',
		empty: '#000000'
	},
	grid: OWL_COLOR_ROWS.map(rowToCells)
};
