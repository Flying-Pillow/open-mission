import { DaemonClient } from './DaemonClient.js';
import { DaemonControlApi } from './DaemonControlApi.js';
import { DaemonMissionApi } from './DaemonMissionApi.js';

export class DaemonApi {
	public readonly control: DaemonControlApi;
	public readonly mission: DaemonMissionApi;

	public constructor(client: DaemonClient) {
		this.control = new DaemonControlApi(client);
		this.mission = new DaemonMissionApi(client);
	}
}