# NOC Incident Desk — Standalone Development

This branch is the standalone platform migration. It is based on the TT Editor / Quick Update feature branch and keeps that work in its history.

## Prerequisites

- Node.js 26 LTS or newer
- npm 10.8 or newer
- Docker Desktop with Docker Compose
- Google OAuth credentials for browser sign-in (local password login is enabled in Better Auth, but the current UI exposes the Google sign-in action)

## Start locally on Windows PowerShell

Run these commands from the `source` folder:

```powershell
Copy-Item .env.example .env
$secret = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
$content = Get-Content .env -Raw
$content = $content.Replace('replace-with-at-least-32-random-characters', $secret)
Set-Content .env $content -NoNewline

docker compose -f docker-compose.standalone.yml up -d
npm install
npm run db:migrate
npm run dev
```

Open:

- Web application: http://127.0.0.1:5173
- API liveness: http://127.0.0.1:4000/api/health/live
- API readiness: http://127.0.0.1:4000/api/health/ready

The `dev` command starts the Hono API and Vite web server together. The Vite dev server proxies `/api` and `/socket.io` to the API.

## Google OAuth

Create a Google OAuth 2.0 Web application client and add this local authorized redirect URI:

```text
http://127.0.0.1:5173/api/auth/callback/google
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, then restart the API. Never prefix server secrets with `VITE_` and never commit `.env`.

The current login UI uses Google OAuth. Better Auth email/password is enabled server-side for future account UI work, but the existing UI has not yet been extended with email/password form controls.

## Optional capabilities

- **Gemini:** set `GEMINI_API_KEY`; the key is read only by the API process.
- **Browser push:** generate VAPID credentials with `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- **SMTP:** configure the `SMTP_*` values when transactional email delivery is added.
- **Attachments:** development files are stored below `.data/uploads`. Keep that directory on a persistent volume in deployments.

## Useful commands

```powershell
npm run dev          # API + web, watch mode
npm run dev:api      # API only
npm run dev:web      # web only
npm run typecheck    # TypeScript check
npm run build        # API bundle + production web build
npm run preview      # preview built web assets
npm run db:migrate   # apply versioned SQL migrations
```

## Data and cutover warning

The standalone database starts empty. Existing AppDeploy users, workspaces, incidents, timeline updates, audit/version history, route master records, and attachment files are **not imported automatically** by this branch. Do not delete, reset, or decommission the current AppDeploy data.

Before production cutover, export and verify the source data, build an idempotent import with a dry-run report, transfer attachment objects and verify checksums, reissue invitations where necessary, and rehearse rollback against a restorable copy. Better Auth sessions are not portable from the previous provider, so users should expect to sign in again after cutover.

## Windows Application Control note

If Windows Application Control blocks a native `.node` module used by Vite/Rolldown, do not disable endpoint protection to make the build run. Use an approved developer allowlist from the device administrator or build in an approved WSL2/Linux environment. The CI workflow builds on Linux as an independent verification path.
