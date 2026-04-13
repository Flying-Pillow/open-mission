import type {
	AirportClientConnect,
	AirportClientObserve,
	AirportPaneBind
} from '../daemon/protocol/contracts.js';
import type { MissionSystemSnapshot } from '../types.js';
import { DaemonClient } from './DaemonClient.js';

export class DaemonAirportApi {
	public constructor(private readonly client: DaemonClient) { }

	public async getStatus(): Promise<MissionSystemSnapshot> {
		return this.client.request<MissionSystemSnapshot>('airport.status');
	}

	public async connectPane(params: AirportClientConnect): Promise<MissionSystemSnapshot> {
		return this.client.request<MissionSystemSnapshot>('airport.client.connect', params);
	}

	public async observeClient(params: AirportClientObserve): Promise<MissionSystemSnapshot> {
		return this.client.request<MissionSystemSnapshot>('airport.client.observe', params);
	}

	public async bindPane(params: AirportPaneBind): Promise<MissionSystemSnapshot> {
		return this.client.request<MissionSystemSnapshot>('airport.pane.bind', params);
	}
}