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
			title: "Kanban",
			href: "/kanban",
			isActive: pathname.startsWith("/kanban"),
		},
		{
			title: "Documentation",
			href: "/docs",
			isActive: isDocsRoutePath(pathname),
		},
	];
}
