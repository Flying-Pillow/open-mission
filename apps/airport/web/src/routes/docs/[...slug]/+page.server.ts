import { error as kitError } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { resolveDocsPage, serializeDocsPage } from "$lib/docs/manifest";

export const load: PageServerLoad = async ({ params }) => {
	try {
		const slug = params.slug?.split("/").filter(Boolean) ?? [];
		const page = await resolveDocsPage(slug);

		return {
			page: serializeDocsPage(page),
		};
	} catch (loadError) {
		const message =
			loadError instanceof Error ? loadError.message : String(loadError);

		throw kitError(404, message);
	}
};
