import type { AppContextServerValue } from '$lib/client/context/app-context.svelte';

declare global {
    namespace App {
        interface Locals {
            githubAuthToken?: string;
            appContext: AppContextServerValue;
        }
    }
}

export { };