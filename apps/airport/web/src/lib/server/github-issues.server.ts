// /apps/airport/web/src/lib/server/github-issues.server.ts: Fetches GitHub issue details for Airport web using the authenticated GitHub API.
import type { GitHubIssueDetailDto } from '@flying-pillow/mission-core';

type GitHubIssuePayload = {
    number: number;
    title: string;
    body?: string;
    html_url?: string;
    updated_at?: string;
    labels?: Array<string | { name?: string }>;
    assignees?: Array<{ login?: string }>;
    pull_request?: unknown;
};

export async function fetchGitHubIssueDetail(input: {
    workspaceRoot: string;
    issueNumber: number;
    repository?: string;
    authToken?: string;
}): Promise<GitHubIssueDetailDto> {
    const repository = input.repository?.trim();
    if (!repository) {
        throw new Error('GitHub issue detail requires a repository in owner/name format.');
    }

    const payload = await fetchGitHubIssuePayload({
        repository,
        issueNumber: input.issueNumber,
        authToken: input.authToken
    });

    if (payload.pull_request) {
        throw new Error(`GitHub item #${input.issueNumber} is a pull request, not an issue.`);
    }

    return {
        number: payload.number,
        title: payload.title,
        body: payload.body?.trim() || 'Issue body not captured yet.',
        ...(payload.html_url ? { url: payload.html_url } : {}),
        ...(payload.updated_at ? { updatedAt: payload.updated_at } : {}),
        labels: (payload.labels ?? [])
            .map((label) => typeof label === 'string' ? label : String(label.name ?? '').trim())
            .filter(Boolean),
        assignees: (payload.assignees ?? [])
            .map((assignee) => String(assignee.login ?? '').trim())
            .filter(Boolean)
    };
}

async function fetchGitHubIssuePayload(input: {
    repository: string;
    issueNumber: number;
    authToken?: string;
}): Promise<GitHubIssuePayload> {
    const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(input.repository).replace('%2F', '/')}/issues/${input.issueNumber}`,
        {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'mission-airport-web',
                ...(input.authToken?.trim() ? { Authorization: `Bearer ${input.authToken.trim()}` } : {})
            }
        }
    );

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message.trim() || `GitHub issue fetch failed with status ${response.status}.`);
    }

    return response.json() as Promise<GitHubIssuePayload>;
}