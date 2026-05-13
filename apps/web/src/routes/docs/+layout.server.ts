import type { LayoutServerLoad } from "./$types";
import {
	loadDocsManifest,
	serializeDocsNavigation,
} from "$lib/docs/manifest";

export const load: LayoutServerLoad = async () => {
	const manifest = await loadDocsManifest();

	return {
		navigation: serializeDocsNavigation(manifest.navigation),
		site: {
			title: manifest.rootPage.title,
			description: manifest.rootPage.description,
			href: manifest.rootPage.href,
		},
	};
};
