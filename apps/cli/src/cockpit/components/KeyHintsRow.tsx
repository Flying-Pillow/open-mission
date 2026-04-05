/** @jsxImportSource @opentui/solid */

import { cockpitTheme } from './cockpitTheme.js';

type KeyHintsRowProps = {
	text: string;
};

export function KeyHintsRow(props: KeyHintsRowProps) {
	return (
		<text style={{ fg: cockpitTheme.mutedText }}>
			{props.text}
		</text>
	);
}