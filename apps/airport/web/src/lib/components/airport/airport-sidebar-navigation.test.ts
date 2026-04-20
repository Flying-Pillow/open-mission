import { describe, expect, it } from "vitest";
import { getAirportSidebarNavigation } from "./airport-sidebar-navigation";

describe("getAirportSidebarNavigation", () => {
	it("always exposes the documentation entry for discoverability", () => {
		expect(getAirportSidebarNavigation("/")).toEqual([
			{
				title: "Documentation",
				href: "/docs",
				isActive: false,
			},
		]);
	});

	it("marks the documentation entry active for docs routes only", () => {
		expect(getAirportSidebarNavigation("/docs")).toEqual([
			{
				title: "Documentation",
				href: "/docs",
				isActive: true,
			},
		]);
		expect(getAirportSidebarNavigation("/docs/getting-started")).toEqual([
			{
				title: "Documentation",
				href: "/docs",
				isActive: true,
			},
		]);
		expect(getAirportSidebarNavigation("/repository/example")).toEqual([
			{
				title: "Documentation",
				href: "/docs",
				isActive: false,
			},
		]);
	});
});
