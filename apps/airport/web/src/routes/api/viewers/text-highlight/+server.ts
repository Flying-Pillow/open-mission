import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { renderArtifactTextHtml } from '$lib/server/viewers/text-highlighter.server';

const textHighlightRequestSchema = z.object({
    source: z.string(),
    language: z.string().trim().min(1).optional()
}).strict();

export const POST: RequestHandler = async ({ request }) => {
    const input = textHighlightRequestSchema.parse(await request.json());
    return json({
        html: await renderArtifactTextHtml(input)
    });
};