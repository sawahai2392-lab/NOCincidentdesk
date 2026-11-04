# NOC Incident Desk — Standalone Development

This branch is the standalone platform migration. It is based on the TT Editor / Quick Update feature branch and keeps that work in its history.

## Prerequisites

- Windows 10/11 or a supported Windows Server release
- Node.js 26 LTS or newer
- npm 10.8 or newer
- PostgreSQL 18.6 installed natively on Windows
- Google OAuth is optional. Email/password registration and sign-in are available locally.

Docker Desktop, Docker Engine, Docker Compose, and WSL2 are **not required**.

## Install PostgreSQL on Windows

1. Download the official Windows installer from [PostgreSQL Windows installers](https://www.postgresql.org/download/windows/). The PostgreSQL project links to the EDB interactive installer.
2. Select PostgreSQL Server, pgAdmin 4, and Command Line Tools during setup.
3. Keep port `5432` unless another local service already uses it.
4. Set and securely store the PostgreSQL administrator password for the `postgres` account.
5. Finish the installation and make sure the PostgreSQL Windows service is running.

The installer normally places command-line tools under `C:\Program Files\PostgreSQL\18\bin`. The setup script below searches this location automatically, so adding it to PATH is optional.

## Start locally on Windows PowerShell

Run these commands from the `source` folder:

```powershell
Copy-Item .env.example .env
$secret = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
$content = Get-Content .env -Raw
$content = $content.Replace('replace-with-at-least-32-random-characters', $secret)
Set-Content .env $content -NoNewline

# Create the local role and database in native PostgreSQL.
.\scripts\setup-local-postgres.ps1

npm install
npm run db:migrate
npm run dev
```

The setup script asks for the PostgreSQL administrator password. By default it creates or updates:

- Database: `nocdesk`
- Application role: `nocdesk`
- Local development password: `nocdesk_local_only`

Those defaults match `DATABASE_URL` in `.env.example`. They are for local development only; keep PostgreSQL bound to localhost and use a unique secret for any shared or production environment. To use a different application password, pass `-AppPassword` to the setup script and update `DATABASE_URL` in `.env` to match.

Open:

- Web application: http://127.0.0.1:5173
- API liveness: http://127.0.0.1:4000/api/health/live
- API readiness: http://127.0.0.1:4000/api/health/ready

The `dev` command starts the Hono API and Vite web server together. The Vite dev server proxies `/api` and `/socket.io` to the API.

## Authentication

The login screen supports email/password registration and sign-in. New account passwords must be at least 12 characters. The first account created in a fresh standalone database becomes the initial workspace Admin. Keep registration restricted or add an invitation/approval policy before exposing the service publicly.

Google OAuth is optional. To enable it, create a Google OAuth 2.0 Web application client and add this local authorized redirect URI:

```text
http://127.0.0.1:5173/api/auth/callback/google
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, then restart the API. Never prefix server secrets with `VITE_` and never commit `.env`.

Email/password registration and sign-in work without configuring an OAuth provider. Google is an optional additional login method.

## Optional capabilities

- **Gemini:** set `GEMINI_API_KEY`; the key is read only by the API process.
- **Browser push:** generate VAPID credentials with `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- **SMTP:** configure the `SMTP_*` values when transactional email delivery is added.
- **Attachments:** development files are stored below `.data/uploads`. Keep that directory on persistent storage in deployments.

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
