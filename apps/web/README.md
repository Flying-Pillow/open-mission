# Open Mission Web

Open Mission web is the SvelteKit surface for Mission's browser-based repository and mission workflows.

## Development

From the repository root:

```sh
pnpm --dir apps/web run dev
```

The package dev command runs Vite+ on `0.0.0.0:5174`. From the repository root,
`pnpm run dev` starts both Open Mission web and the Open Mission daemon source runtime.

## GitHub Device Flow

Open Mission web uses GitHub device flow in the login form.

Set a GitHub client id for the registered app and ensure device flow is enabled in the GitHub app settings:

```sh
GITHUB_APP_CLIENT_ID=...
```

or:

```sh
GITHUB_OAUTH_CLIENT_ID=...
```

Optional settings:

```sh
GITHUB_OAUTH_SCOPE="repo read:user user:email"
OPEN_MISSION_WEB_AUTH_STORAGE_PATH="/tmp/open-mission-web-auth"
```

The browser stores only an opaque session cookie. The GitHub access token stays in a server-side session record and is forwarded to daemon-backed GitHub operations from the server.

## Build

```sh
pnpm --dir apps/web run build
pnpm --dir apps/web run preview
```
