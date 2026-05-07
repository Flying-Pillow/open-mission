import type { SystemState } from '../../system/SystemContract.js';
import { DaemonClient } from './DaemonClient.js';

export class DaemonSystemApi {
	public constructor(private readonly client: DaemonClient) { }

	public async getStatus(options: { timeoutMs?: number } = {}): Promise<SystemState> {
		return this.client.request<SystemState>('system.status', undefined, options);
	}
}