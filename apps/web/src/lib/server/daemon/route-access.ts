import { allowsDaemonlessRouteAccess } from "$lib/docs/route-paths";

export function shouldRenderDaemonRouteContent(input: {
	pathname: string;
	daemonRunning: boolean;
}): boolean {
	return input.daemonRunning || allowsDaemonlessRouteAccess(input.pathname);
}

export function shouldRedirectUnavailableDaemonRoute(input: {
	pathname: string;
	daemonRunning: boolean;
}): boolean {
	const isRootPage = input.pathname === "/";
	const isApiRequest = input.pathname.startsWith("/api/");
	const isAuthRequest = input.pathname.startsWith("/auth/");
	const isRemoteFunctionRequest = input.pathname.startsWith("/_app/remote/");

	return (
		!input.daemonRunning &&
		!isRootPage &&
		!allowsDaemonlessRouteAccess(input.pathname) &&
		!isApiRequest &&
		!isAuthRequest &&
		!isRemoteFunctionRequest
	);
}
