/** @jsxImportSource @opentui/solid */

import { cockpitTheme } from './cockpitTheme.js';
import { Panel } from './Panel.js';

type StatusStripProps = {
	missionLabel: string;
	stageLabel: string;
	taskLabel: string;
	sessionLabel: string;
	modelLabel: string;
	modeLabel: string;
};

export function StatusStrip(props: StatusStripProps) {
	return (
		<Panel
			title="STATUS"
			contentStyle={{ flexDirection: 'row', gap: 3 }}
			footerBadges={[
				{ text: `session ${props.sessionLabel}` },
				{ text: `model ${props.modelLabel}` },
				{ text: `mode ${props.modeLabel}`, tone: props.modeLabel === 'interactive' ? 'accent' : 'neutral' }
			]}
		>
			<text style={{ fg: cockpitTheme.bodyText }}>mission={props.missionLabel}</text>
			<text style={{ fg: cockpitTheme.bodyText }}>stage={props.stageLabel}</text>
			<text style={{ fg: cockpitTheme.bodyText }}>task={props.taskLabel}</text>
		</Panel>
	);
}