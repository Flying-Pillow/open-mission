type CockpitThemePalette = {
	background: string;
	headerBackground: string;
	panelBackground: string;
	accent: string;
	accentSoft: string;
	border: string;
	borderMuted: string;
	title: string;
	brightText: string;
	metaText: string;
	labelText: string;
	primaryText: string;
	secondaryText: string;
	bodyText: string;
	mutedText: string;
	success: string;
	warning: string;
	danger: string;
};

export const cockpitThemes = {
	ocean: {
		background: '#08111b',
		headerBackground: '#0b1725',
		panelBackground: '#09131f',
		accent: '#55d7ff',
		accentSoft: '#163247',
		border: '#304860',
		borderMuted: '#223344',
		title: '#8ba7c4',
		brightText: '#f3fbff',
		metaText: '#a1b7cf',
		labelText: '#7f94ad',
		primaryText: '#e7f6ff',
		secondaryText: '#9bb0c8',
		bodyText: '#d9e9f8',
		mutedText: '#60758d',
		success: '#7ef0b8',
		warning: '#ffd36e',
		danger: '#ff8f8f'
	},
	sand: {
		background: '#1d1710',
		headerBackground: '#2a2117',
		panelBackground: '#241c13',
		accent: '#ffb74a',
		accentSoft: '#4f3414',
		border: '#6a4b2c',
		borderMuted: '#4a331f',
		title: '#d7b993',
		brightText: '#fff7ea',
		metaText: '#d9bd9b',
		labelText: '#c19e76',
		primaryText: '#fff0dc',
		secondaryText: '#deb98e',
		bodyText: '#f2dbc0',
		mutedText: '#9e7d5a',
		success: '#a3e3a1',
		warning: '#ffd36e',
		danger: '#ff9a8f'
	},
	mono: {
		background: '#000000',
		headerBackground: '#050505',
		panelBackground: '#0a0a0a',
		accent: '#ffffff',
		accentSoft: '#222222',
		border: '#4a4a4a',
		borderMuted: '#2d2d2d',
		title: '#ffffff',
		brightText: '#ffffff',
		metaText: '#e0e0e0',
		labelText: '#c6c6c6',
		primaryText: '#ffffff',
		secondaryText: '#d5d5d5',
		bodyText: '#f2f2f2',
		mutedText: '#9b9b9b',
		success: '#b5ffb5',
		warning: '#ffe28a',
		danger: '#ffb0b0'
	},
	paper: {
		background: '#e8e8e8',
		headerBackground: '#dfdfdf',
		panelBackground: '#ededed',
		accent: '#1f5fbf',
		accentSoft: '#dbe7ff',
		border: '#707070',
		borderMuted: '#b0b0b0',
		title: '#202020',
		brightText: '#000000',
		metaText: '#303030',
		labelText: '#4a4a4a',
		primaryText: '#111111',
		secondaryText: '#2f2f2f',
		bodyText: '#111111',
		mutedText: '#676767',
		success: '#0d7a42',
		warning: '#8a5d00',
		danger: '#a22a2a'
	}
} satisfies Record<string, CockpitThemePalette>;

export type CockpitThemeName = keyof typeof cockpitThemes;

export const cockpitTheme: CockpitThemePalette = { ...cockpitThemes.ocean };

export function applyCockpitTheme(themeName: CockpitThemeName): void {
	Object.assign(cockpitTheme, cockpitThemes[themeName]);
}

export function isCockpitThemeName(value: unknown): value is CockpitThemeName {
	return typeof value === 'string' && value in cockpitThemes;
}