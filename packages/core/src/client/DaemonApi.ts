import { DaemonClient } from './DaemonClient.js';
import { DaemonEntityApi } from './DaemonEntityApi.js';
import { DaemonSystemApi } from './DaemonSystemApi.js';

export class DaemonApi {
	public readonly entity: DaemonEntityApi;
	public readonly system: DaemonSystemApi;

	public constructor(client: DaemonClient) {
		this.entity = new DaemonEntityApi(client);
		this.system = new DaemonSystemApi(client);
	}
}