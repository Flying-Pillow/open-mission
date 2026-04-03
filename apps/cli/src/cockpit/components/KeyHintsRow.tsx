/** @jsxImportSource @opentui/solid */

import { cockpitTheme } from './cockpitTheme.js';

export function KeyHintsRow() {
	return (
		<text style={{ fg: cockpitTheme.mutedText }}>
			↑↓ panels | ↑↓ lane | ←→ select | Enter submit | /launch selected task | q quit
		</text>
	);
}