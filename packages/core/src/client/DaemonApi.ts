import { DaemonClient } from './DaemonClient.js';
import { DaemonAirportApi } from './DaemonAirportApi.js';
import { DaemonControlApi } from './DaemonControlApi.js';
import { DaemonMissionApi } from './DaemonMissionApi.js';
import { DaemonSystemApi } from './DaemonSystemApi.js';

export class DaemonApi {
	public readonly airport: DaemonAirportApi;
	public readonly control: DaemonControlApi;
	public readonly mission: DaemonMissionApi;
	public readonly system: DaemonSystemApi;

	public constructor(client: DaemonClient) {
		this.airport = new DaemonAirportApi(client);
		this.control = new DaemonControlApi(client);
		this.mission = new DaemonMissionApi(client);
		this.system = new DaemonSystemApi(client);
	}
}