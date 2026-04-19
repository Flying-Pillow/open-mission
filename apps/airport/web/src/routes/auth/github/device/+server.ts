import { json } from '@sveltejs/kit';
import {
    getGitHubDeviceConfigurationError,
    normalizeRedirectTarget,
    startGithubDeviceAuthorization
} from '$lib/server/github-auth.server';

export const POST = async ({ cookies, url }) => {
    const configurationError = getGitHubDeviceConfigurationError();
    if (configurationError) {
        return json({
            message: configurationError
        }, {
            status: 400
        });
    }

    try {
        return json(
            await startGithubDeviceAuthorization({
                cookies,
                redirectTo: normalizeRedirectTarget(url.searchParams.get('redirectTo'))
            })
        );
    } catch (error) {
        return json({
            message: error instanceof Error ? error.message : String(error)
        }, {
            status: 400
        });
    }
};