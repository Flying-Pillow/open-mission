import type { OpenMissionApplication } from '$lib/client/Application.svelte.js';

let appInstance: OpenMissionApplication | undefined;

export function getApp(): OpenMissionApplication {
    if (!appInstance) {
        throw new Error('Open Mission application instance has not been initialized.');
    }

    return appInstance;
}

export function setApp(instance: OpenMissionApplication): void {
    appInstance = instance;
}