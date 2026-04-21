import type {
	AirportClientConnect,
	AirportClientObserve,
	AirportPaneBind
} from '../daemon/protocol/contracts.js';
import type { SystemSnapshot } from '../types.js';
import { DaemonClient } from './DaemonClient.js';

export class DaemonAirportApi {
	public constructor(private readonly client: DaemonClient) { }

	public async getStatus(): Promise<SystemSnapshot> {
		return this.client.request<SystemSnapshot>('airport.status');
	}

	public async connectPane(params: AirportClientConnect): Promise<SystemSnapshot> {
		return this.client.request<SystemSnapshot>('airport.client.connect', params);
	}

	public async observeClient(params: AirportClientObserve): Promise<SystemSnapshot> {
		return this.client.request<SystemSnapshot>('airport.client.observe', params);
	}

	public async bindPane(params: AirportPaneBind): Promise<SystemSnapshot> {
		return this.client.request<SystemSnapshot>('airport.pane.bind', params);
	}
}