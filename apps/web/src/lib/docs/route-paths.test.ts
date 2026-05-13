import { describe, expect, it } from "vitest";
import {
	allowsDaemonlessRouteAccess,
	isDocsRoutePath,
	normalizeRoutePath,
} from "./route-paths";

describe("normalizeRoutePath", () => {
	it("normalizes empty and trailing-slash paths", () => {
		expect(normalizeRoutePath("")).toBe("/");
		expect(normalizeRoutePath("/docs/")).toBe("/docs");
		expect(normalizeRoutePath("/docs/getting-started///")).toBe(
			"/docs/getting-started",
		);
	});
});

describe("isDocsRoutePath", () => {
	it("matches the docs index and descendant routes", () => {
		expect(isDocsRoutePath("/docs")).toBe(true);
		expect(isDocsRoutePath("/docs/")).toBe(true);
		expect(isDocsRoutePath("/docs/getting-started")).toBe(true);
	});

	it("does not match non-doc routes", () => {
		expect(isDocsRoutePath("/")).toBe(false);
		expect(isDocsRoutePath("/app/example")).toBe(false);
		expect(isDocsRoutePath("/docs-guides")).toBe(false);
	});
});

describe("allowsDaemonlessRouteAccess", () => {
	it("only bypasses the daemon gate for docs routes", () => {
		expect(allowsDaemonlessRouteAccess("/docs/reference")).toBe(true);
		expect(allowsDaemonlessRouteAccess("/")).toBe(false);
		expect(allowsDaemonlessRouteAccess("/login")).toBe(false);
	});
});
