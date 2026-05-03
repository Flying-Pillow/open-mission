import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDaemonRuntimeState = vi.fn();
const readCachedDaemonSystemStatus = vi.fn();
const readGithubAuthToken = vi.fn();
const readGithubSessionContext = vi.fn();
const resolveSurfacePath = vi.fn();

vi.mock("$lib/server/daemon/health.server", () => ({
	getDaemonRuntimeState,
	readCachedDaemonSystemStatus,
}));

vi.mock("$lib/server/github-auth.server", () => ({
	readGithubAuthToken,
	readGithubSessionContext,
}));

vi.mock("$lib/server/daemon/context.server", () => ({
	resolveSurfacePath,
}));

const daemonUnavailableState = {
	running: false,
	startedByHook: false,
	message: "Mission daemon is unavailable.",
	lastCheckedAt: "2026-04-20T00:00:00.000Z",
} as const;

describe("handle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDaemonRuntimeState.mockResolvedValue(daemonUnavailableState);
		readCachedDaemonSystemStatus.mockResolvedValue(undefined);
		readGithubAuthToken.mockResolvedValue(undefined);
		readGithubSessionContext.mockResolvedValue({ authenticated: false });
		resolveSurfacePath.mockReturnValue("/workspace");
	});

	it("keeps docs routes reachable when the daemon is unavailable", async () => {
		const { handle } = await import("./hooks.server");
		const resolve = vi.fn().mockResolvedValue(new Response("docs ok"));

		const response = await handle({
			event: createEvent("http://127.0.0.1:4175/docs/getting-started"),
			resolve,
		});

		expect(await response.text()).toBe("docs ok");
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it("redirects daemon-gated routes back to the landing page", async () => {
		const { handle } = await import("./hooks.server");
		const resolve = vi.fn().mockResolvedValue(new Response("repo ok"));

		await expect(
			handle({
				event: createEvent("http://127.0.0.1:4175/airport/example"),
				resolve,
			}),
		).rejects.toMatchObject({
			status: 303,
			location: "/",
		});
		expect(resolve).not.toHaveBeenCalled();
	});

	it("preserves api and auth requests outside the docs exception", async () => {
		const { handle } = await import("./hooks.server");
		const resolve = vi.fn().mockResolvedValue(new Response("ok"));

		await handle({
			event: createEvent("http://127.0.0.1:4175/api/runtime/events"),
			resolve,
		});
		await handle({
			event: createEvent("http://127.0.0.1:4175/auth/github/callback"),
			resolve,
		});

		expect(resolve).toHaveBeenCalledTimes(2);
	});
});

function createEvent(url: string) {
	const requestUrl = new URL(url);

	return {
		url: requestUrl,
		request: new Request(url),
		cookies: {} as RequestEvent['cookies'],
		locals: {} as App.Locals,
		fetch,
		getClientAddress: () => '127.0.0.1',
		params: {},
		platform: undefined,
		route: { id: null },
		setHeaders: () => { },
		isDataRequest: false,
		isSubRequest: false,
	} as unknown as RequestEvent;
}
