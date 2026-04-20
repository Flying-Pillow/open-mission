import { isDocsRoutePath } from "$lib/docs/route-paths";

export type AirportSidebarNavigationItem = {
	title: string;
	href: string;
	isActive: boolean;
};

export function getAirportSidebarNavigation(
	pathname: string,
): AirportSidebarNavigationItem[] {
	return [
		{
			title: "Documentation",
			href: "/docs",
			isActive: isDocsRoutePath(pathname),
		},
	];
}
