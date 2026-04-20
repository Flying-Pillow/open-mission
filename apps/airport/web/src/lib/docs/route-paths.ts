export function normalizeRoutePath(pathname: string): string {
	const trimmedPathname = pathname.trim();

	if (trimmedPathname.length === 0) {
		return "/";
	}

	if (trimmedPathname.length === 1) {
		return trimmedPathname;
	}

	return trimmedPathname.replace(/\/+$/u, "");
}

export function isDocsRoutePath(pathname: string): boolean {
	const normalizedPathname = normalizeRoutePath(pathname);

	return (
		normalizedPathname === "/docs" ||
		normalizedPathname.startsWith("/docs/")
	);
}

export function allowsDaemonlessRouteAccess(pathname: string): boolean {
	return isDocsRoutePath(pathname);
}
