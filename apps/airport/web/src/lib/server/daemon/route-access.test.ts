import { describe, expect, it } from "vitest";
import {
	shouldRedirectUnavailableDaemonRoute,
	shouldRenderDaemonRouteContent,
} from "./route-access";

describe("shouldRenderDaemonRouteContent", () => {
	it("keeps docs reachable through the shell while the daemon is unavailable", () => {
		expect(
			shouldRenderDaemonRouteContent({
				pathname: "/docs",
				daemonRunning: false,
			}),
		).toBe(true);
		expect(
			shouldRenderDaemonRouteContent({
				pathname: "/docs/reference",
				daemonRunning: false,
			}),
		).toBe(true);
	});

	it("continues gating non-doc routes until the daemon is running", () => {
		expect(
			shouldRenderDaemonRouteContent({
				pathname: "/repository/example",
				daemonRunning: false,
			}),
		).toBe(false);
		expect(
			shouldRenderDaemonRouteContent({
				pathname: "/repository/example",
				daemonRunning: true,
			}),
		).toBe(true);
	});
});

describe("shouldRedirectUnavailableDaemonRoute", () => {
	it("redirects daemon-gated application routes back to the landing page", () => {
		expect(
			shouldRedirectUnavailableDaemonRoute({
				pathname: "/repository/example",
				daemonRunning: false,
			}),
		).toBe(true);
		expect(
			shouldRedirectUnavailableDaemonRoute({
				pathname: "/docs-guides",
				daemonRunning: false,
			}),
		).toBe(true);
	});

	it("keeps the exception narrow to docs while preserving root, api, and auth routes", () => {
		expect(
			shouldRedirectUnavailableDaemonRoute({
				pathname: "/docs",
				daemonRunning: false,
			}),
		).toBe(false);
		expect(
			shouldRedirectUnavailableDaemonRoute({
				pathname: "/docs/getting-started",
				daemonRunning: false,
			}),
		).toBe(false);
		expect(
			shouldRedirectUnavailableDaemonRoute({
				pathname: "/",
				daemonRunning: false,
			}),
		).toBe(false);
		expect(
			shouldRedirectUnavailableDaemonRoute({
				pathname: "/api/runtime/events",
				daemonRunning: false,
			}),
		).toBe(false);
		expect(
			shouldRedirectUnavailableDaemonRoute({
				pathname: "/auth/github/callback",
				daemonRunning: false,
			}),
		).toBe(false);
	});
});
