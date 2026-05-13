import { isDocsRoutePath } from "$lib/docs/route-paths";

export type AppSidebarNavigationItem = {
	title: string;
	href: string;
	isActive: boolean;
};

export function getAppSidebarNavigation(
	pathname: string,
): AppSidebarNavigationItem[] {
	return [
		{
			title: "Documentation",
			href: "/docs",
			isActive: isDocsRoutePath(pathname),
		},
	];
}
