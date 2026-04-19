import { json } from '@sveltejs/kit';
import { pollGithubDeviceAuthorization } from '$lib/server/github-auth.server';

export const POST = async ({ cookies }) => {
    const result = await pollGithubDeviceAuthorization(cookies);
    return json(result, {
        status: result.status === 'error' ? 400 : 200
    });
};