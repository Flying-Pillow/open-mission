import type { AirportApplication } from '$lib/client/Application.svelte.js';

let appInstance: AirportApplication | undefined;

export function getApp(): AirportApplication {
    if (!appInstance) {
        throw new Error('Airport application instance has not been initialized.');
    }

    return appInstance;
}

export function setApp(instance: AirportApplication): void {
    appInstance = instance;
}