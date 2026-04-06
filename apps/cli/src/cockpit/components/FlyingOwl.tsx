/** @jsxImportSource @opentui/solid */

import { type JSXElement } from 'solid-js';
import { buildBrailleBannerLines } from '../banner/renderBrailleBanner.js';
import { missionOwlBrailleBanner } from '../banner/missionOwlBraille.js';
import { banner as wordmarkBanner } from '../banner/wordmark.js';

type FlyingOwlProps = {
	width?: number;
	height?: number;
};

const DEFAULT_WIDTH = 72;
const DEFAULT_HEIGHT = 20;
const OWL_LINES = buildBrailleBannerLines(missionOwlBrailleBanner);
const WORDMARK_LINES = wordmarkBanner.replace(/^\n+|\n+$/g, '').split('\n');

export function FlyingOwl(props: FlyingOwlProps) {
	const width = props.width ?? DEFAULT_WIDTH;
	const height = props.height ?? DEFAULT_HEIGHT;

	return (
		<box
			style={{
				flexDirection: 'column',
				alignItems: 'center',
				gap: 1,
				width
			}}
		>
			<box
				style={{
					width,
					height,
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center'
				}}
			>
				{OWL_LINES.map((line) => renderBannerLine(line))}
			</box>
			<box style={{ flexDirection: 'column', alignItems: 'center' }}>
				{WORDMARK_LINES.map((line) => (
					<text>{line}</text>
				))}
			</box>
		</box>
	);
}

function renderBannerLine(
	line: Array<{ text: string; color?: string }>
): JSXElement {
	return (
		<box style={{ flexDirection: 'row' }}>
			{line.map((segment) => (
				segment.color
					? <text style={{ fg: segment.color }}>{segment.text}</text>
					: <text>{segment.text}</text>
			))}
		</box>
	);
}