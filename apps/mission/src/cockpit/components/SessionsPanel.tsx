/** @jsxImportSource @opentui/solid */

import type { MissionAgentSessionRecord } from '@flying-pillow/mission-core';
import { For, Show } from 'solid-js';
import { cockpitTheme } from './cockpitTheme.js';
import { Panel } from './Panel.js';

type SessionsPanelProps = {
	sessions: MissionAgentSessionRecord[];
	activeSessionId: string | undefined;
};

export function SessionsPanel(props: SessionsPanelProps) {
	return (
		<Panel title="SESSIONS" style={{ flexGrow: 1 }}>
			<Show when={props.sessions.length > 0} fallback={<text style={{ fg: cockpitTheme.secondaryText }}>No agent session is active.</text>}>
				<For each={props.sessions.slice(0, 5)}>
					{(session) => (
						<text style={{ fg: session.sessionId === props.activeSessionId ? cockpitTheme.accent : cockpitTheme.bodyText }}>
							{session.sessionId} | {session.runtimeId} | {session.lifecycleState}
						</text>
					)}
				</For>
			</Show>
		</Panel>
	);
}