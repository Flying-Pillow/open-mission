import { error } from '@sveltejs/kit';
import type { ImpeccableLiveSessionType } from '@flying-pillow/open-mission-core/daemon/impeccable/ImpeccableLiveSession';
import { DaemonGateway } from '$lib/server/daemon/daemon-gateway';

const OWNER_SELECTOR_QUERY_KEYS = new Set([
    'repositoryId',
    'missionId'
]);

type ResolveLiveProxyContextInput = {
    locals: App.Locals;
    url: URL;
};

type ResolvedLiveProxyContext = {
    session: ImpeccableLiveSessionType;
}

export function buildProxyOrigin(input: {
    requestUrl: URL;
    repositoryId?: string;
    missionId?: string;
}): string {
    const proxyUrl = new URL('/api/impeccable/live', input.requestUrl);

    const repositoryId = input.repositoryId?.trim();
    if (repositoryId) {
        proxyUrl.searchParams.set('repositoryId', repositoryId);
    }

    const missionId = input.missionId?.trim();
    if (missionId) {
        proxyUrl.searchParams.set('missionId', missionId);
    }

    return proxyUrl.toString();
}

export function rewriteLiveScriptOrigin(script: string, proxyOrigin: string): string {
    if (script.includes('window.__IMPECCABLE_ORIGIN__ = ')) {
        return script.replace(
            /window\.__IMPECCABLE_ORIGIN__ = ['"][^'"]*['"];/,
            `window.__IMPECCABLE_ORIGIN__ = ${JSON.stringify(proxyOrigin)};`
        );
    }

    return `${`window.__IMPECCABLE_ORIGIN__ = ${JSON.stringify(proxyOrigin)};\n`}${script}`;
}

function stripOwnerSelectorQuery(url: URL): URL {
    const upstreamUrl = new URL(url.toString());
    for (const key of OWNER_SELECTOR_QUERY_KEYS) {
        upstreamUrl.searchParams.delete(key);
    }
    return upstreamUrl;
}

export async function resolveLiveProxyContext(input: ResolveLiveProxyContextInput): Promise<ResolvedLiveProxyContext> {
    const repositoryId = input.url.searchParams.get('repositoryId')?.trim() || undefined;
    const missionId = input.url.searchParams.get('missionId')?.trim() || undefined;
    if ((!repositoryId && !missionId) || (repositoryId && missionId)) {
        error(400, 'Provide exactly one of repositoryId or missionId.');
    }
    const session = await new DaemonGateway(input.locals).resolveImpeccableLiveSession({
        repositoryId,
        missionId
    }).catch((resolutionError) => {
        error(404, resolutionError instanceof Error
            ? resolutionError.message
            : 'No running Impeccable live server could be resolved.');
    });

    return {
        session
    };
}

export async function proxyLiveRequest(input: {
    request: Request;
    requestUrl: URL;
    path: string;
    session: ImpeccableLiveSessionType;
}): Promise<Response> {
    const upstreamUrl = stripOwnerSelectorQuery(input.requestUrl);
    const sessionOrigin = new URL(input.session.origin);
    upstreamUrl.protocol = sessionOrigin.protocol;
    upstreamUrl.hostname = sessionOrigin.hostname;
    upstreamUrl.port = sessionOrigin.port;
    upstreamUrl.pathname = `/${input.path}`;

    const upstreamHeaders = new Headers(input.request.headers);
    upstreamHeaders.delete('host');
    upstreamHeaders.delete('content-length');

    const upstreamResponse = await fetch(upstreamUrl, {
        method: input.request.method,
        headers: upstreamHeaders,
        body: ['GET', 'HEAD'].includes(input.request.method)
            ? undefined
            : await input.request.arrayBuffer(),
        signal: input.request.signal
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete('content-length');

    if (input.path === 'live.js') {
        return new Response(await upstreamResponse.text(), {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders
        });
    }

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders
    });
}