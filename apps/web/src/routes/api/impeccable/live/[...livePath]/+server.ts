import { error, type RequestHandler } from '@sveltejs/kit';
import { buildProxyOrigin, proxyLiveRequest, resolveLiveProxyContext, rewriteLiveScriptOrigin } from '$lib/server/impeccable/live-proxy.server';

async function handleProxy(event: Parameters<RequestHandler>[0]): Promise<Response> {
    const livePath = event.params.livePath?.trim();
    if (!livePath) {
        error(404, 'Missing Impeccable live endpoint path.');
    }

    const repositoryId = event.url.searchParams.get('repositoryId')?.trim() || undefined;
    const missionId = event.url.searchParams.get('missionId')?.trim() || undefined;
    const { session } = await resolveLiveProxyContext({
        locals: event.locals,
        url: event.url
    });
    const upstreamResponse = await proxyLiveRequest({
        request: event.request,
        requestUrl: event.url,
        path: livePath,
        session
    });

    if (livePath !== 'live.js') {
        return upstreamResponse;
    }

    return new Response(
        rewriteLiveScriptOrigin(
            await upstreamResponse.text(),
            buildProxyOrigin({
                requestUrl: event.url,
                repositoryId,
                missionId
            })
        ),
        {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: upstreamResponse.headers
        }
    );
}

export const GET: RequestHandler = handleProxy;
export const POST: RequestHandler = handleProxy;
export const PUT: RequestHandler = handleProxy;
export const PATCH: RequestHandler = handleProxy;
export const DELETE: RequestHandler = handleProxy;
export const OPTIONS: RequestHandler = handleProxy;