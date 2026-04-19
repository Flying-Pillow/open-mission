# Mission Airport Web

Airport web is the SvelteKit surface for Mission's browser-based repository and mission workflows.

## Development

From the repository root:

```sh
pnpm --dir apps/airport/web run dev
```

For a remotely reachable dev server:

```sh
pnpm --dir apps/airport/web run dev:remote
```

## GitHub OAuth

Airport web uses a GitHub OAuth redirect flow in the login form.

Airport web also supports GitHub device flow for headless or cross-browser sign-in, as long as device flow is enabled in the GitHub app settings.

Set one of these client-id and client-secret pairs:

```sh
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
```

or:

```sh
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
```

Optional settings:

```sh
GITHUB_OAUTH_SCOPE="repo read:user user:email"
GITHUB_OAUTH_CALLBACK_URL="http://127.0.0.1:5174/auth/github/callback"
MISSION_AIRPORT_WEB_AUTH_STORAGE_PATH="/tmp/mission-airport-web-auth"
```

If `GITHUB_OAUTH_CALLBACK_URL` is not set, Airport derives the callback URL from the incoming request origin and uses `/auth/github/callback`.

The browser stores only an opaque session cookie. The GitHub access token stays in a server-side session record and is forwarded to daemon-backed GitHub operations from the server.

## Build

```sh
pnpm --dir apps/airport/web run build
pnpm --dir apps/airport/web run preview
```
