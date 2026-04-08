import type {
	AirportClientConnect,
	AirportClientObserve,
	AirportGateBind
} from '../daemon/contracts.js';
import type { MissionSystemSnapshot } from '../types.js';
import { DaemonClient } from './DaemonClient.js';

export class DaemonAirportApi {
	public constructor(private readonly client: DaemonClient) { }

	public async getStatus(): Promise<MissionSystemSnapshot> {
		return this.client.request<MissionSystemSnapshot>('airport.status');
	}

	public async connectPanel(params: AirportClientConnect = {}): Promise<MissionSystemSnapshot> {
		return this.client.request<MissionSystemSnapshot>('airport.client.connect', params);
	}

	public async observeClient(params: AirportClientObserve): Promise<MissionSystemSnapshot> {
		return this.client.request<MissionSystemSnapshot>('airport.client.observe', params);
	}

	public async bindGate(params: AirportGateBind): Promise<MissionSystemSnapshot> {
		return this.client.request<MissionSystemSnapshot>('airport.gate.bind', params);
	}
}