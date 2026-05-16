// /apps/web/src/lib/server/github-auth.server.ts: GitHub OAuth and server-side session helpers for Open Mission web.
import { randomBytes, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Cookies } from '@sveltejs/kit';
import { resolveSurfacePath } from './daemon/context.server';

const LEGACY_GITHUB_AUTH_COOKIE_NAME = 'open_mission_github_auth_token';
export const GITHUB_AUTH_SESSION_COOKIE_NAME = 'open_mission_github_auth_session';
export const GITHUB_AUTH_STATE_COOKIE_NAME = 'open_mission_github_auth_state';
export const GITHUB_AUTH_DEVICE_COOKIE_NAME = 'open_mission_github_auth_device';

const GITHUB_AUTH_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const GITHUB_AUTH_STATE_TTL_SECONDS = 60 * 10;
const GITHUB_AUTH_REFRESH_WINDOW_MS = 60 * 1000;

type GitHubOAuthSessionRecord = {
    sessionId: string;
    accessToken: string;
    githubUserId?: string;
    githubLogin?: string;
    githubEmail?: string;
    githubAvatarUrl?: string;
    tokenType?: string;
    scope?: string;
    refreshToken?: string;
    accessTokenExpiresAt?: string;
    refreshTokenExpiresAt?: string;
    sessionExpiresAt?: string;
    createdAt: string;
    updatedAt: string;
};

type GitHubAuthenticatedUser = {
    id?: number | string;
    login?: string;
    email?: string;
    avatar_url?: string;
};

export type GitHubSessionContext = {
    authenticated: boolean;
    user?: {
        name: string;
        email?: string;
        avatarUrl?: string;
    };
};

type GitHubOAuthStateRecord = {
    state: string;
    redirectTo: string;
};

type GitHubOAuthTokenResponse = {
    access_token?: string;
    token_type?: string;
    scope?: string;
    expires_in?: number | string;
    interval?: number | string;
    refresh_token?: string;
    refresh_token_expires_in?: number | string;
    error?: string;
    error_description?: string;
};

type GitHubDeviceCodeResponse = {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number | string;
    interval?: number | string;
    error?: string;
    error_description?: string;
};

type GitHubDeviceAuthRecord = {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
    redirectTo: string;
    expiresAt: string;
};

type GitHubDeviceAuthorizationStart = {
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
    expiresAt: string;
};

type GitHubDeviceAuthorizationPollResult =
    | {
        status: 'pending';
        intervalSeconds: number;
        expiresAt: string;
    }
    | {
        status: 'authorized';
        redirectTo: string;
    }
    | {
        status: 'error';
        message: string;
    };

export function hasGitHubOAuthConfiguration(): boolean {
    return Boolean(resolveGitHubOAuthClientId() && resolveGitHubOAuthClientSecret());
}

export function hasGitHubDeviceConfiguration(): boolean {
    return Boolean(resolveGitHubOAuthClientId());
}

export function getGitHubOAuthConfigurationError(): string | undefined {
    if (hasGitHubOAuthConfiguration()) {
        return undefined;
    }

    return 'GitHub OAuth is not configured. Set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET, or GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.';
}

export function getGitHubDeviceConfigurationError(): string | undefined {
    if (hasGitHubDeviceConfiguration()) {
        return undefined;
    }

    return 'GitHub device flow is not configured. Set GITHUB_APP_CLIENT_ID or GITHUB_OAUTH_CLIENT_ID and enable device flow in the GitHub app settings.';
}

export async function readGithubAuthToken(cookies: Cookies): Promise<string | undefined> {
    const session = await readGithubAuthSession(cookies);
    return session?.accessToken;
}

export async function readGithubSessionContext(cookies: Cookies): Promise<GitHubSessionContext> {
    const session = await readGithubAuthSession(cookies);
    if (!session) {
        return { authenticated: false };
    }

    const name = session.githubLogin?.trim();
    const email = session.githubEmail?.trim();
    const avatarUrl = session.githubAvatarUrl?.trim();

    return {
        authenticated: true,
        ...(name
            ? {
                user: {
                    name,
                    ...(email ? { email } : {}),
                    ...(avatarUrl ? { avatarUrl } : {})
                }
            }
            : {})
    };
}

export async function clearGithubAuthSession(cookies: Cookies): Promise<void> {
    const sessionId = cookies.get(GITHUB_AUTH_SESSION_COOKIE_NAME)?.trim();
    if (sessionId) {
        const session = await readGithubAuthSessionRecord(sessionId);
        if (session?.githubUserId) {
            await deleteGithubAuthSessionsForUser(session.githubUserId);
        } else {
            await deleteGithubAuthSessionRecord(sessionId);
        }
    }

    clearGithubAuthSessionCookie(cookies);
    clearGithubAuthStateCookie(cookies);
    clearGithubAuthDeviceCookie(cookies);
    clearLegacyGithubAuthTokenCookie(cookies);
}

export async function startGithubDeviceAuthorization(input: {
    cookies: Cookies;
    redirectTo: string;
}): Promise<GitHubDeviceAuthorizationStart> {
    const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'open-mission-web'
        },
        body: new URLSearchParams({
            client_id: requireGitHubOAuthClientId(),
            scope: resolveGitHubOAuthScope()
        }).toString()
    });

    const payload = await parseGitHubDeviceCodeResponse(response);
    if (
        !response.ok
        || !payload.device_code?.trim()
        || !payload.user_code?.trim()
        || !payload.verification_uri?.trim()
    ) {
        throw new Error(payload.error_description?.trim() || payload.error?.trim() || 'GitHub device authorization could not be started.');
    }

    const expiresAt = resolveExpiryIso(new Date(), payload.expires_in);
    if (!expiresAt) {
        throw new Error('GitHub device authorization returned an invalid expiration window.');
    }

    const intervalSeconds = resolveIntervalSeconds(payload.interval);
    const deviceRecord: GitHubDeviceAuthRecord = {
        deviceCode: payload.device_code.trim(),
        userCode: payload.user_code.trim(),
        verificationUri: payload.verification_uri.trim(),
        intervalSeconds,
        redirectTo: normalizeRedirectTarget(input.redirectTo),
        expiresAt
    };

    writeGithubAuthDeviceCookie(input.cookies, deviceRecord);

    return {
        userCode: deviceRecord.userCode,
        verificationUri: deviceRecord.verificationUri,
        intervalSeconds: deviceRecord.intervalSeconds,
        expiresAt: deviceRecord.expiresAt
    };
}

export async function pollGithubDeviceAuthorization(cookies: Cookies): Promise<GitHubDeviceAuthorizationPollResult> {
    const deviceRecord = readGithubAuthDeviceCookie(cookies);
    if (!deviceRecord) {
        return {
            status: 'error',
            message: 'No active GitHub device authorization request was found. Start device sign-in again.'
        };
    }

    if (isExpired(deviceRecord.expiresAt)) {
        clearGithubAuthDeviceCookie(cookies);
        return {
            status: 'error',
            message: 'The GitHub device code expired. Start device sign-in again.'
        };
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'open-mission-web'
        },
        body: new URLSearchParams({
            client_id: requireGitHubOAuthClientId(),
            device_code: deviceRecord.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }).toString()
    });

    const payload = await parseGitHubOAuthTokenResponse(response);
    const accessToken = payload.access_token?.trim();
    if (accessToken) {
        await persistGithubAuthSessionFromTokenResponse(cookies, {
            ...payload,
            access_token: accessToken
        });
        clearGithubAuthDeviceCookie(cookies);
        return {
            status: 'authorized',
            redirectTo: deviceRecord.redirectTo
        };
    }

    const errorCode = payload.error?.trim();
    if (errorCode === 'authorization_pending') {
        return {
            status: 'pending',
            intervalSeconds: deviceRecord.intervalSeconds,
            expiresAt: deviceRecord.expiresAt
        };
    }

    if (errorCode === 'slow_down') {
        const slowedRecord: GitHubDeviceAuthRecord = {
            ...deviceRecord,
            intervalSeconds: resolveIntervalSeconds(payload.interval, deviceRecord.intervalSeconds + 5)
        };
        writeGithubAuthDeviceCookie(cookies, slowedRecord);
        return {
            status: 'pending',
            intervalSeconds: slowedRecord.intervalSeconds,
            expiresAt: slowedRecord.expiresAt
        };
    }

    clearGithubAuthDeviceCookie(cookies);
    return {
        status: 'error',
        message: payload.error_description?.trim() || resolveGithubDeviceErrorMessage(errorCode) || 'GitHub device authorization failed.'
    };
}

export async function createGithubOAuthAuthorization(input: {
    cookies: Cookies;
    requestUrl: URL;
    redirectTo: string;
}): Promise<URL> {
    const clientId = requireGitHubOAuthClientId();
    const state = randomBytes(24).toString('hex');
    const redirectTo = normalizeRedirectTarget(input.redirectTo);

    writeGithubAuthStateCookie(input.cookies, {
        state,
        redirectTo
    });

    const authorizationUrl = new URL('https://github.com/login/oauth/authorize');
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', resolveGitHubOAuthCallbackUrl(input.requestUrl));
    authorizationUrl.searchParams.set('scope', resolveGitHubOAuthScope());
    authorizationUrl.searchParams.set('state', state);

    return authorizationUrl;
}

export async function completeGithubOAuthCallback(input: {
    cookies: Cookies;
    requestUrl: URL;
    code: string;
    state: string;
}): Promise<{ redirectTo: string }> {
    const expectedState = readGithubAuthStateCookie(input.cookies);
    clearGithubAuthStateCookie(input.cookies);

    if (!expectedState || expectedState.state !== input.state) {
        throw new Error('GitHub OAuth state verification failed. Start the sign-in flow again.');
    }

    const tokenResponse = await exchangeGitHubOAuthCode({
        requestUrl: input.requestUrl,
        code: input.code
    });
    await persistGithubAuthSessionFromTokenResponse(input.cookies, tokenResponse);

    return {
        redirectTo: expectedState.redirectTo
    };
}

function writeGithubAuthSessionCookie(cookies: Cookies, sessionId: string): void {
    cookies.set(GITHUB_AUTH_SESSION_COOKIE_NAME, sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        maxAge: GITHUB_AUTH_SESSION_TTL_SECONDS
    });
}

function clearGithubAuthSessionCookie(cookies: Cookies): void {
    cookies.delete(GITHUB_AUTH_SESSION_COOKIE_NAME, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production'
    });
}

function writeGithubAuthStateCookie(cookies: Cookies, state: GitHubOAuthStateRecord): void {
    cookies.set(GITHUB_AUTH_STATE_COOKIE_NAME, JSON.stringify(state), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        maxAge: GITHUB_AUTH_STATE_TTL_SECONDS
    });
}

function readGithubAuthStateCookie(cookies: Cookies): GitHubOAuthStateRecord | undefined {
    const raw = cookies.get(GITHUB_AUTH_STATE_COOKIE_NAME)?.trim();
    if (!raw) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<GitHubOAuthStateRecord>;
        const state = typeof parsed.state === 'string' ? parsed.state.trim() : '';
        const redirectTo = normalizeRedirectTarget(parsed.redirectTo);
        return state ? { state, redirectTo } : undefined;
    } catch {
        return undefined;
    }
}

function clearGithubAuthStateCookie(cookies: Cookies): void {
    cookies.delete(GITHUB_AUTH_STATE_COOKIE_NAME, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production'
    });
}

function writeGithubAuthDeviceCookie(cookies: Cookies, deviceRecord: GitHubDeviceAuthRecord): void {
    const expiresAt = Date.parse(deviceRecord.expiresAt);
    const maxAgeSeconds = Number.isFinite(expiresAt)
        ? Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000))
        : 60 * 15;

    cookies.set(GITHUB_AUTH_DEVICE_COOKIE_NAME, JSON.stringify(deviceRecord), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        maxAge: maxAgeSeconds
    });
}

function readGithubAuthDeviceCookie(cookies: Cookies): GitHubDeviceAuthRecord | undefined {
    const raw = cookies.get(GITHUB_AUTH_DEVICE_COOKIE_NAME)?.trim();
    if (!raw) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<GitHubDeviceAuthRecord>;
        const deviceCode = typeof parsed.deviceCode === 'string' ? parsed.deviceCode.trim() : '';
        const userCode = typeof parsed.userCode === 'string' ? parsed.userCode.trim() : '';
        const verificationUri = typeof parsed.verificationUri === 'string' ? parsed.verificationUri.trim() : '';
        const expiresAt = typeof parsed.expiresAt === 'string' ? parsed.expiresAt.trim() : '';
        if (!deviceCode || !userCode || !verificationUri || !expiresAt) {
            return undefined;
        }

        return {
            deviceCode,
            userCode,
            verificationUri,
            intervalSeconds: resolveIntervalSeconds(parsed.intervalSeconds),
            redirectTo: normalizeRedirectTarget(parsed.redirectTo),
            expiresAt
        };
    } catch {
        return undefined;
    }
}

function clearGithubAuthDeviceCookie(cookies: Cookies): void {
    cookies.delete(GITHUB_AUTH_DEVICE_COOKIE_NAME, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production'
    });
}

function clearLegacyGithubAuthTokenCookie(cookies: Cookies): void {
    cookies.delete(LEGACY_GITHUB_AUTH_COOKIE_NAME, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production'
    });
}

async function readGithubAuthSession(cookies: Cookies): Promise<GitHubOAuthSessionRecord | undefined> {
    const sessionId = cookies.get(GITHUB_AUTH_SESSION_COOKIE_NAME)?.trim();
    if (!sessionId) {
        return undefined;
    }

    const session = await readGithubAuthSessionRecord(sessionId);
    if (!session) {
        clearGithubAuthSessionCookie(cookies);
        return undefined;
    }

    if (isExpired(session.sessionExpiresAt)) {
        await deleteGithubAuthSessionRecord(sessionId);
        clearGithubAuthSessionCookie(cookies);
        return undefined;
    }

    if (isExpired(session.refreshTokenExpiresAt)) {
        await deleteGithubAuthSessionRecord(sessionId);
        clearGithubAuthSessionCookie(cookies);
        return undefined;
    }

    if (shouldRefreshGithubAccessToken(session)) {
        if (!session.refreshToken) {
            if (isExpired(session.accessTokenExpiresAt)) {
                await deleteGithubAuthSessionRecord(sessionId);
                clearGithubAuthSessionCookie(cookies);
                return undefined;
            }

            return session;
        }

        try {
            const refreshed = await refreshGithubOAuthSession(session);
            await persistGithubAuthSessionRecord(refreshed);
            return refreshed;
        } catch {
            await deleteGithubAuthSessionRecord(sessionId);
            clearGithubAuthSessionCookie(cookies);
            return undefined;
        }
    }

    return session;
}

async function exchangeGitHubOAuthCode(input: {
    requestUrl: URL;
    code: string;
}): Promise<Required<Pick<GitHubOAuthTokenResponse, 'access_token'>> & GitHubOAuthTokenResponse> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'open-mission-web'
        },
        body: JSON.stringify({
            client_id: requireGitHubOAuthClientId(),
            client_secret: requireGitHubOAuthClientSecret(),
            code: input.code,
            redirect_uri: resolveGitHubOAuthCallbackUrl(input.requestUrl)
        })
    });

    const payload = await parseGitHubOAuthTokenResponse(response);
    if (!response.ok || !payload.access_token?.trim()) {
        throw new Error(payload.error_description?.trim() || payload.error?.trim() || 'GitHub OAuth token exchange failed.');
    }

    return {
        ...payload,
        access_token: payload.access_token.trim()
    };
}

async function refreshGithubOAuthSession(session: GitHubOAuthSessionRecord): Promise<GitHubOAuthSessionRecord> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'open-mission-web'
        },
        body: JSON.stringify({
            client_id: requireGitHubOAuthClientId(),
            client_secret: requireGitHubOAuthClientSecret(),
            grant_type: 'refresh_token',
            refresh_token: session.refreshToken
        })
    });

    const payload = await parseGitHubOAuthTokenResponse(response);
    if (!response.ok || !payload.access_token?.trim()) {
        throw new Error(payload.error_description?.trim() || payload.error?.trim() || 'GitHub OAuth token refresh failed.');
    }

    const now = new Date();
    return {
        ...session,
        accessToken: payload.access_token.trim(),
        ...(payload.token_type ? { tokenType: payload.token_type.trim() } : {}),
        ...(payload.scope ? { scope: payload.scope.trim() } : {}),
        ...(payload.refresh_token ? { refreshToken: payload.refresh_token.trim() } : {}),
        ...(resolveExpiryIso(now, payload.expires_in)
            ? { accessTokenExpiresAt: resolveExpiryIso(now, payload.expires_in) }
            : {}),
        ...(resolveExpiryIso(now, payload.refresh_token_expires_in)
            ? { refreshTokenExpiresAt: resolveExpiryIso(now, payload.refresh_token_expires_in) }
            : session.refreshTokenExpiresAt
                ? { refreshTokenExpiresAt: session.refreshTokenExpiresAt }
                : {}),
        ...(session.sessionExpiresAt ? { sessionExpiresAt: session.sessionExpiresAt } : {}),
        updatedAt: now.toISOString()
    };
}

async function persistGithubAuthSessionFromTokenResponse(
    cookies: Cookies,
    tokenResponse: Required<Pick<GitHubOAuthTokenResponse, 'access_token'>> & GitHubOAuthTokenResponse
): Promise<void> {
    const sessionRecord = await buildGithubAuthSessionRecord(tokenResponse);
    await persistGithubAuthSessionRecord(sessionRecord);
    writeGithubAuthSessionCookie(cookies, sessionRecord.sessionId);
    clearLegacyGithubAuthTokenCookie(cookies);
}

async function buildGithubAuthSessionRecord(
    tokenResponse: Required<Pick<GitHubOAuthTokenResponse, 'access_token'>> & GitHubOAuthTokenResponse
): Promise<GitHubOAuthSessionRecord> {
    const now = new Date();
    const githubUser = await readGitHubAuthenticatedUser(tokenResponse.access_token.trim());
    const githubUserId = normalizeOptionalString(githubUser?.id);
    const githubLogin = normalizeOptionalString(githubUser?.login);
    const githubEmail = normalizeOptionalString(githubUser?.email);
    const githubAvatarUrl = normalizeOptionalString(githubUser?.avatar_url);

    return {
        sessionId: randomBytes(24).toString('hex'),
        accessToken: tokenResponse.access_token.trim(),
        ...(githubUserId ? { githubUserId } : {}),
        ...(githubLogin ? { githubLogin } : {}),
        ...(githubEmail ? { githubEmail } : {}),
        ...(githubAvatarUrl ? { githubAvatarUrl } : {}),
        ...(tokenResponse.token_type ? { tokenType: tokenResponse.token_type.trim() } : {}),
        ...(tokenResponse.scope ? { scope: tokenResponse.scope.trim() } : {}),
        ...(tokenResponse.refresh_token ? { refreshToken: tokenResponse.refresh_token.trim() } : {}),
        ...(resolveExpiryIso(now, tokenResponse.expires_in)
            ? { accessTokenExpiresAt: resolveExpiryIso(now, tokenResponse.expires_in) }
            : {}),
        ...(resolveExpiryIso(now, tokenResponse.refresh_token_expires_in)
            ? { refreshTokenExpiresAt: resolveExpiryIso(now, tokenResponse.refresh_token_expires_in) }
            : {}),
        sessionExpiresAt: new Date(now.getTime() + GITHUB_AUTH_SESSION_TTL_SECONDS * 1000).toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
}

async function readGitHubAuthenticatedUser(accessToken: string): Promise<GitHubAuthenticatedUser | undefined> {
    const response = await fetch('https://api.github.com/user', {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'open-mission-web'
        }
    });

    if (!response.ok) {
        return undefined;
    }

    try {
        return await response.json() as GitHubAuthenticatedUser;
    } catch {
        return undefined;
    }
}

async function parseGitHubOAuthTokenResponse(response: Response): Promise<GitHubOAuthTokenResponse> {
    const text = await response.text();
    if (!text.trim()) {
        return {};
    }

    try {
        return JSON.parse(text) as GitHubOAuthTokenResponse;
    } catch {
        return {
            error: `GitHub OAuth returned an unexpected response (${response.status}).`,
            error_description: text.trim()
        };
    }
}

async function parseGitHubDeviceCodeResponse(response: Response): Promise<GitHubDeviceCodeResponse> {
    const text = await response.text();
    if (!text.trim()) {
        return {};
    }

    try {
        return JSON.parse(text) as GitHubDeviceCodeResponse;
    } catch {
        return {
            error: `GitHub device flow returned an unexpected response (${response.status}).`,
            error_description: text.trim()
        };
    }
}

function shouldRefreshGithubAccessToken(session: GitHubOAuthSessionRecord): boolean {
    const expiresAt = session.accessTokenExpiresAt ? Date.parse(session.accessTokenExpiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt)) {
        return false;
    }

    return expiresAt - Date.now() <= GITHUB_AUTH_REFRESH_WINDOW_MS;
}

function isExpired(expiresAt?: string): boolean {
    const timestamp = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp <= Date.now() : false;
}

function resolveExpiryIso(now: Date, expiresIn?: number | string): string | undefined {
    const seconds = typeof expiresIn === 'string' ? Number.parseInt(expiresIn, 10) : expiresIn;
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
        return undefined;
    }

    return new Date(now.getTime() + seconds * 1000).toISOString();
}

function resolveIntervalSeconds(interval?: number | string, fallback = 5): number {
    const seconds = typeof interval === 'string' ? Number.parseInt(interval, 10) : interval;
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
        return fallback;
    }

    return seconds;
}

function resolveGithubDeviceErrorMessage(errorCode?: string): string | undefined {
    switch (errorCode) {
        case 'access_denied':
            return 'GitHub device authorization was denied.';
        case 'expired_token':
            return 'The GitHub device code expired. Start device sign-in again.';
        case 'device_flow_disabled':
            return 'GitHub device flow is disabled for this app. Enable device flow in the app settings first.';
        case 'incorrect_client_credentials':
            return 'GitHub device flow client credentials are invalid.';
        case 'incorrect_device_code':
            return 'GitHub device flow returned an invalid device code.';
        case 'unsupported_grant_type':
            return 'GitHub device flow grant type was rejected.';
        default:
            return errorCode ? `GitHub device authorization failed: ${errorCode}.` : undefined;
    }
}

async function persistGithubAuthSessionRecord(session: GitHubOAuthSessionRecord): Promise<void> {
    const directory = await ensureGithubAuthSessionDirectory();
    await cleanupGithubAuthSessionDirectory(directory);
    await fs.writeFile(resolveGithubAuthSessionFilePath(session.sessionId), JSON.stringify(session), 'utf8');
}

async function readGithubAuthSessionRecord(sessionId: string): Promise<GitHubOAuthSessionRecord | undefined> {
    if (!/^[a-f0-9]+$/u.test(sessionId)) {
        return undefined;
    }

    try {
        const raw = await fs.readFile(resolveGithubAuthSessionFilePath(sessionId), 'utf8');
        const parsed = JSON.parse(raw) as Partial<GitHubOAuthSessionRecord>;
        if (typeof parsed.sessionId !== 'string' || parsed.sessionId !== sessionId) {
            return undefined;
        }
        if (typeof parsed.accessToken !== 'string' || parsed.accessToken.trim().length === 0) {
            return undefined;
        }

        return {
            sessionId,
            accessToken: parsed.accessToken.trim(),
            ...(normalizeOptionalString(parsed.githubUserId) ? { githubUserId: normalizeOptionalString(parsed.githubUserId) } : {}),
            ...(normalizeOptionalString(parsed.githubLogin) ? { githubLogin: normalizeOptionalString(parsed.githubLogin) } : {}),
            ...(normalizeOptionalString(parsed.githubEmail) ? { githubEmail: normalizeOptionalString(parsed.githubEmail) } : {}),
            ...(normalizeOptionalString(parsed.githubAvatarUrl) ? { githubAvatarUrl: normalizeOptionalString(parsed.githubAvatarUrl) } : {}),
            ...(typeof parsed.tokenType === 'string' && parsed.tokenType.trim()
                ? { tokenType: parsed.tokenType.trim() }
                : {}),
            ...(typeof parsed.scope === 'string' && parsed.scope.trim() ? { scope: parsed.scope.trim() } : {}),
            ...(typeof parsed.refreshToken === 'string' && parsed.refreshToken.trim()
                ? { refreshToken: parsed.refreshToken.trim() }
                : {}),
            ...(typeof parsed.accessTokenExpiresAt === 'string' && parsed.accessTokenExpiresAt.trim()
                ? { accessTokenExpiresAt: parsed.accessTokenExpiresAt.trim() }
                : {}),
            ...(typeof parsed.refreshTokenExpiresAt === 'string' && parsed.refreshTokenExpiresAt.trim()
                ? { refreshTokenExpiresAt: parsed.refreshTokenExpiresAt.trim() }
                : {}),
            ...(typeof parsed.sessionExpiresAt === 'string' && parsed.sessionExpiresAt.trim()
                ? { sessionExpiresAt: parsed.sessionExpiresAt.trim() }
                : {}),
            createdAt:
                typeof parsed.createdAt === 'string' && parsed.createdAt.trim().length > 0
                    ? parsed.createdAt.trim()
                    : new Date().toISOString(),
            updatedAt:
                typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim().length > 0
                    ? parsed.updatedAt.trim()
                    : new Date().toISOString()
        };
    } catch {
        return undefined;
    }
}

async function deleteGithubAuthSessionRecord(sessionId: string): Promise<void> {
    if (!/^[a-f0-9]+$/u.test(sessionId)) {
        return;
    }

    try {
        await fs.unlink(resolveGithubAuthSessionFilePath(sessionId));
    } catch {
        // Ignore missing session files.
    }
}

async function deleteGithubAuthSessionsForUser(githubUserId: string): Promise<void> {
    const normalizedGitHubUserId = normalizeOptionalString(githubUserId);
    if (!normalizedGitHubUserId) {
        return;
    }

    const sessionIds = await listGithubAuthSessionIds();
    await Promise.all(
        sessionIds.map(async (sessionId) => {
            const session = await readGithubAuthSessionRecord(sessionId);
            if (session?.githubUserId === normalizedGitHubUserId) {
                await deleteGithubAuthSessionRecord(sessionId);
            }
        })
    );
}

async function ensureGithubAuthSessionDirectory(): Promise<string> {
    const directory = resolveGithubAuthSessionDirectory();
    await fs.mkdir(directory, { recursive: true });
    return directory;
}

async function cleanupGithubAuthSessionDirectory(directory: string): Promise<void> {
    const sessionIds = await listGithubAuthSessionIds(directory);
    await Promise.all(
        sessionIds.map(async (sessionId) => {
            const session = await readGithubAuthSessionRecord(sessionId);
            if (!session) {
                await deleteGithubAuthSessionRecord(sessionId);
                return;
            }

            if (isExpired(session.sessionExpiresAt) || isExpired(session.refreshTokenExpiresAt)) {
                await deleteGithubAuthSessionRecord(session.sessionId);
            }
        })
    );
}

async function listGithubAuthSessionIds(directory = resolveGithubAuthSessionDirectory()): Promise<string[]> {
    try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => entry.name.slice(0, -5));
    } catch {
        return [];
    }
}

function resolveGithubAuthSessionDirectory(): string {
    const configuredDirectory = process.env['OPEN_MISSION_WEB_AUTH_STORAGE_PATH']?.trim();
    if (configuredDirectory) {
        return configuredDirectory;
    }

    const surfacePath = resolveSurfacePath();
    const surfaceHash = createHash('sha256').update(surfacePath).digest('hex').slice(0, 16);
    return path.join(tmpdir(), 'open-mission-web', 'github-auth', surfaceHash, 'sessions');
}

function resolveGithubAuthSessionFilePath(sessionId: string): string {
    return path.join(resolveGithubAuthSessionDirectory(), `${sessionId}.json`);
}

function resolveGitHubOAuthClientId(): string | undefined {
    return process.env['GITHUB_APP_CLIENT_ID']?.trim() || process.env['GITHUB_OAUTH_CLIENT_ID']?.trim();
}

function resolveGitHubOAuthClientSecret(): string | undefined {
    return process.env['GITHUB_APP_CLIENT_SECRET']?.trim() || process.env['GITHUB_OAUTH_CLIENT_SECRET']?.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalizedValue = value.trim();
    return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function requireGitHubOAuthClientId(): string {
    const clientId = resolveGitHubOAuthClientId();
    if (!clientId) {
        throw new Error(getGitHubOAuthConfigurationError() ?? 'GitHub OAuth client id is not configured.');
    }
    return clientId;
}

function requireGitHubOAuthClientSecret(): string {
    const clientSecret = resolveGitHubOAuthClientSecret();
    if (!clientSecret) {
        throw new Error(getGitHubOAuthConfigurationError() ?? 'GitHub OAuth client secret is not configured.');
    }
    return clientSecret;
}

function resolveGitHubOAuthScope(): string {
    const configuredScope = process.env['GITHUB_OAUTH_SCOPE']?.trim();
    return configuredScope && configuredScope.length > 0 ? configuredScope : 'repo read:user user:email';
}

function resolveGitHubOAuthCallbackUrl(requestUrl: URL): string {
    const configuredCallbackUrl = process.env['GITHUB_OAUTH_CALLBACK_URL']?.trim();
    if (configuredCallbackUrl) {
        return configuredCallbackUrl;
    }

    return new URL('/auth/github/callback', requestUrl).toString();
}

export function normalizeRedirectTarget(candidate: string | null | undefined): string {
    const value = candidate?.trim();
    if (!value || !value.startsWith('/')) {
        return '/';
    }
    if (value.startsWith('//')) {
        return '/';
    }
    return value;
}