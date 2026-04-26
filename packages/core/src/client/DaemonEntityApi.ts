import type {
	EntityCommandInvocation,
	EntityFormInvocation,
	EntityQueryInvocation,
	EntityRemoteResult
} from '../schemas/EntityRemote.js';
import { DaemonClient } from './DaemonClient.js';

export class DaemonEntityApi {
	public constructor(private readonly client: DaemonClient) { }

	public async query(input: EntityQueryInvocation): Promise<EntityRemoteResult> {
		return this.client.request<EntityRemoteResult>('entity.query', input);
	}

	public async command(input: EntityCommandInvocation | EntityFormInvocation): Promise<EntityRemoteResult> {
		return this.client.request<EntityRemoteResult>('entity.command', input);
	}
}