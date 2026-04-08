/** @jsxImportSource @opentui/solid */

import { useKeyboard } from '@opentui/solid';
import { cockpitTheme } from './cockpitTheme.js';

type IntroSplashProps = {
	onComplete: () => void;
	durationMs?: number;
};

export function IntroSplash(props: IntroSplashProps) {
	let completed = false;

	const complete = () => {
		if (completed) {
			return;
		}
		completed = true;
		props.onComplete();
	};

	useKeyboard(() => {
		complete();
	});

	return (
		<box
			style={{
				flexDirection: 'column',
				flexGrow: 1,
				padding: 1,
				justifyContent: 'center',
				alignItems: 'center',
				backgroundColor: cockpitTheme.background
			}}
		>
			<box
				style={{
					flexDirection: 'column',
					alignItems: 'center',
					gap: 1
				}}
			>
				<text style={{ fg: cockpitTheme.brightText }}>MISSION</text>
				<text style={{ fg: cockpitTheme.metaText }}>Press any key to continue</text>
			</box>
		</box>
	);
}