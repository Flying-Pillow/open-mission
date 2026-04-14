import type { SystemStatus } from '../types.js';
import { DaemonClient } from './DaemonClient.js';

export class DaemonSystemApi {
	public constructor(private readonly client: DaemonClient) { }

	public async getStatus(): Promise<SystemStatus> {
		return this.client.request<SystemStatus>('system.status');
	}
}