import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDaemonRuntimeState = vi.fn();
const readCachedDaemonSystemStatus = vi.fn();
const readGithubAuthToken = vi.fn();
const readGithubSessionContext = vi.fn();
const resolveSurfacePath = vi.fn();
const startMissionDaemonBootstrap = vi.fn();

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

vi.mock("$lib/server/daemon/bootstrap.server", () => ({
	startMissionDaemonBootstrap,
}));

const daemonUnavailableState = {
	running: false,
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
		expect(getDaemonRuntimeState).not.toHaveBeenCalled();
	});

	it("does not canonical-redirect api requests on localhost port 5174", async () => {
		const { handle } = await import("./hooks.server");
		const resolve = vi.fn().mockResolvedValue(new Response("api ok"));

		const response = await handle({
			event: createEvent("http://localhost:5174/api/entities/remote/command"),
			resolve,
		});

		expect(await response.text()).toBe("api ok");
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(getDaemonRuntimeState).not.toHaveBeenCalled();
	});

	it("does not redirect remote command requests when the daemon is unavailable", async () => {
		const { handle } = await import("./hooks.server");
		const resolve = vi.fn().mockResolvedValue(new Response("remote ok"));

		const response = await handle({
			event: createEvent("http://127.0.0.1:5174/_app/remote/command-id/cmd"),
			resolve,
		});

		expect(await response.text()).toBe("remote ok");
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(getDaemonRuntimeState).not.toHaveBeenCalled();
	});

	it("does not redirect stripped remote command requests from daemon-gated pages", async () => {
		const { handle } = await import("./hooks.server");
		const resolve = vi.fn().mockResolvedValue(new Response("remote ok"));

		const response = await handle({
			event: createEvent("http://127.0.0.1:5174/airport/github%2FFlying-Pillow%2Fmission", {
				isRemoteRequest: true,
			}),
			resolve,
		});

		expect(await response.text()).toBe("remote ok");
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(getDaemonRuntimeState).not.toHaveBeenCalled();
	});

	it("does not canonical-redirect remote command requests on localhost port 5174", async () => {
		getDaemonRuntimeState.mockResolvedValue({
			running: true,
			message: "Mission daemon connected.",
			lastCheckedAt: "2026-04-20T00:00:00.000Z",
		});
		const { handle } = await import("./hooks.server");
		const resolve = vi.fn().mockResolvedValue(new Response("remote ok"));

		const response = await handle({
			event: createEvent("http://localhost:5174/airport/github%2FFlying-Pillow%2Fmission", {
				isRemoteRequest: true,
			}),
			resolve,
		});

		expect(await response.text()).toBe("remote ok");
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(getDaemonRuntimeState).not.toHaveBeenCalled();
	});
});

function createEvent(url: string, options: { isRemoteRequest?: boolean } = {}) {
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
		isRemoteRequest: options.isRemoteRequest ?? false,
		isSubRequest: false,
	} as unknown as RequestEvent;
}
