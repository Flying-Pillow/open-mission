import type { Method } from './operations.js';
import { PROTOCOL_VERSION } from './operations.js';
import type { AddressedNotification } from './contracts.js';

export { PROTOCOL_VERSION };
export type { Method } from './operations.js';

export type Endpoint = {
    transport: 'ipc';
    path: string;
};

export type Manifest = {
    pid: number;
    startedAt: string;
    protocolVersion: typeof PROTOCOL_VERSION;
    endpoint: Endpoint;
};

export type Ping = {
    ok: true;
    pid: number;
    startedAt: string;
    protocolVersion: typeof PROTOCOL_VERSION;
};

export type Request = {
    type: 'request';
    id: string;
    method: Method;
    surfacePath?: string;
    authToken?: string;
    clientId?: string;
    params?: unknown;
};

export type SuccessResponse = {
    type: 'response';
    id: string;
    ok: true;
    result: unknown;
};

export type ErrorResponse = {
    type: 'response';
    id: string;
    ok: false;
    error: {
        message: string;
        code?: string;
        validationErrors?: unknown[];
    };
};

export type EventMessage = {
    type: 'event';
    event: AddressedNotification;
};

export type Response = SuccessResponse | ErrorResponse;

export type Message = Request | Response | EventMessage;
