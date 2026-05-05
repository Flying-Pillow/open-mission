import type { AgentProviderObservation } from '../AgentProviderObservations.js';
import type { AgentSessionSignalCandidate } from './AgentSessionSignal.js';

export class ProviderOutputSignalParser {
	public parse(observation: AgentProviderObservation): AgentSessionSignalCandidate[] {
		switch (observation.kind) {
			case 'message':
				return [{
					signal: {
						type: 'message',
						channel: observation.channel,
						text: observation.text,
						source: 'provider-structured',
						confidence: 'high'
					}
				}];
			case 'usage':
				return [{
					signal: {
						type: 'usage',
						payload: { ...observation.payload },
						source: 'provider-structured',
						confidence: 'high'
					}
				}];
			case 'signal':
				return [toDiagnosticCandidate(observation)];
			case 'none':
				return [];
		}
	}
}

function toDiagnosticCandidate(observation: Extract<AgentProviderObservation, { kind: 'signal' }>): AgentSessionSignalCandidate {
	if (observation.signal.type === 'provider-session') {
		return {
			dedupeKey: `provider-session:${observation.signal.providerName}:${observation.signal.sessionId}`,
			signal: {
				type: 'diagnostic',
				code: 'provider-session',
				summary: `Provider '${observation.signal.providerName}' reported session '${observation.signal.sessionId}'.`,
				payload: {
					providerName: observation.signal.providerName,
					sessionId: observation.signal.sessionId
				},
				source: observation.signal.source,
				confidence: observation.signal.confidence
			}
		};
	}

	return {
		dedupeKey: `tool-call:${observation.signal.toolName}:${observation.signal.args}`,
		signal: {
			type: 'diagnostic',
			code: 'tool-call',
			summary: `Provider invoked tool '${observation.signal.toolName}'.`,
			detail: observation.signal.args,
			payload: {
				toolName: observation.signal.toolName,
				args: observation.signal.args
			},
			source: observation.signal.source,
			confidence: observation.signal.confidence
		}
	};
}
