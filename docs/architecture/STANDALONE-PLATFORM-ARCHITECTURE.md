# NOC Incident Desk — Standalone Platform Architecture

**Status:** Architecture baseline  
**Decision date:** 2026-11-04  
**Branch:** `feat/standalone-platform-migration`

## 1. Goal

Make NOC Incident Desk deployable and operable without AppDeploy. AppDeploy must no longer be required for frontend modules, API routing, authentication, database access, file storage, realtime messaging, invitations, notifications, AI, secrets, or scheduled work.

The migration is a **modular monolith**, not a microservice collection. One deployable Node.js application owns the domain and data, with clear internal modules and replaceable infrastructure adapters. This is intentionally simpler to operate and debug for the current team size, while leaving room to split workloads later if actual scale requires it.

The local development environment uses native PostgreSQL on Windows. Docker, Docker Compose, Docker Desktop, and WSL2 are not prerequisites.

## 2. Runtime and framework decisions

Use supported, stable releases only. Do not adopt prerelease or experimental packages simply because their version number is larger.

| Layer | Target | Reason |
|---|---|---|
| Runtime | Node.js 26 Active LTS | The machine already has Node 26.13.0; Node 26 entered Active LTS on 2026-10-28. |
| Language | TypeScript 7.0.2, strict mode | Shared compile-time contracts across browser, API, and database. |
| Web UI | React 19.3 + Vite 8.3 | Keep the current client-first dashboard and modernize the build tool without forcing an SSR rewrite where SEO is irrelevant. |
| Routing/data | TanStack Router + TanStack Query | Typed route parameters, route loaders, cache invalidation, prefetching, and predictable server-state handling. |
| API | Hono 4.13.x on Node.js | Small Web-standards-based HTTP layer, portable beyond one hosting platform, and directly compatible with Better Auth's Request/Response handler. |
| Validation/contracts | Zod + OpenAPI | Validate requests at the boundary and publish an API contract. Never trust client-side validation alone. |
| Authentication | Better Auth 1.7.16 or newer patched stable 1.7.x | Database-backed sessions, OAuth, secure cookies, and a framework-agnostic auth layer. Pin a patched stable version in the lockfile. |
| Database | PostgreSQL 18.6 | Open-source relational database with transactions, constraints, JSONB, and strong indexing. |
| Data access | Drizzle ORM + Drizzle Kit | Typed SQL-oriented schema and version-controlled SQL migrations. |
| Realtime | Socket.IO 4.8.x | Workspace-scoped event channels for live incident, member, settings, and alert updates. |
| Files | Storage port with local-disk and S3-compatible adapters | Local development works without a cloud account; production storage can be moved between S3-compatible vendors. |
| AI | Direct provider adapter using the official Google GenAI SDK | Gemini calls remain server-side; the domain is not coupled to AppDeploy's AI wrapper. |
| Jobs | PostgreSQL-backed job queue/scheduler | SLA escalation and maintenance jobs do not require a Redis service for the initial deployment. |
| Testing | Vitest + Playwright | Unit/integration tests and browser-level operational flows. |
| Local infrastructure | Native PostgreSQL 18 Windows installer + pgAdmin | Developers use a local Windows service and a PowerShell database setup script; no container runtime is needed. |

Version guardrails checked on the decision date:
- Node 26 is Active LTS; Node 27 is Alpha and is not a production target.
- React 19.3 is the current stable React line.
- Vite 8.3 is the current supported release line.
- Hono 4.13.16 is stable; Hono 5 is still a release candidate.
- Better Auth 1.7.16 is the patched stable release after the 2026-11-03 security release. Do not pin 1.7.15 or use the 1.8 beta line.
- PostgreSQL 18.6 is the current 18.x maintenance release.
- Socket.IO 4.8.4 is the current 4.x release line.

## 3. Why not microservices or an SSR-first rewrite?

NOC Incident Desk is an authenticated operational console with maps, large forms, timeline editing, offline drafts, spreadsheet imports, and realtime workspace updates. Search-engine indexing is not a product requirement. The existing app is already a React SPA, so retaining client rendering avoids a risky component rewrite and keeps Leaflet/browser-only features straightforward.

TanStack Start 1.0 is now stable and is a valid option for future SSR routes. It is not required for this private operational console. The chosen split is deliberate:
- React/Vite owns browser UI.
- Hono owns HTTP APIs and authentication integration.
- PostgreSQL is the source of truth.
- Socket.IO is a realtime transport, not a second data store.
- Internal domain services own business rules and are independent from all framework adapters.

No database query, authorization decision, AI key, or file-system path may be exposed to the browser.

## 4. Target repository shape

The migration is incremental. Existing UI components and CSS are retained initially; files move only when imports and tests can be updated safely.

```text
source/
  apps/
    web/                     # React/Vite dashboard
    api/                     # Hono Node API + Socket.IO server
  packages/
    contracts/               # Zod schemas, DTOs, API types
    domain/                  # incident, SLA, permissions, audit rules
    database/                # Drizzle schema, migrations, repositories
    auth/                    # Better Auth config and session helpers
    storage/                 # local and S3-compatible storage adapters
    integrations/            # Gemini, SMTP, Web Push
  scripts/
    setup-local-postgres.ps1 # Native Windows PostgreSQL role/database setup
    migrate-appdeploy-export.ts
  docs/
    architecture/
  .env.example
  package.json                # npm workspaces; lockfile committed
```

A compatibility facade may temporarily preserve the current UI's `api`, `auth`, `image`, `invitesClient`, `notifications`, and `ws` interface while implementations are replaced. It must be local source code and must not resolve to an AppDeploy package.

## 5. Domain and data model

PostgreSQL becomes the sole source of truth. Every tenant-owned row carries a non-null `workspace_id`; all repository methods require a workspace context. The API must verify both membership and role for every protected action.

Core tables:
- Identity: Better Auth `user`, `account`, `session`, `verification`.
- Workspace: `workspaces`, `workspace_members`, `workspace_invitations`, `workspace_settings`.
- Incident: `incidents`, `incident_versions`, `incident_audit_logs`, `incident_attachments`.
- Operational details: `incident_impacts`, `incident_progress`, `incident_cut_points`, `incident_geo_coordinates`.
- Master data: `route_master_imports`, `route_master_items`.
- Notifications: `notifications`, `push_subscriptions`.
- Operational processing: `job_runs` / queue tables managed by the PostgreSQL-backed job runner.

Important integrity rules:
- Unique incident ID is enforced per workspace for active/non-trashed incidents using a database constraint/index, not only a preflight query.
- Incident status changes, audit append, version snapshots, and outbox/realtime event creation run in one transaction.
- Progress history edits/deletions follow the existing immutability/authorization rules.
- Version snapshots preserve a complete recoverable incident state.
- Attachment metadata is stored in PostgreSQL; file bytes remain in the storage adapter.
- Server-side role matrix remains Admin, Supervisor, Operator. The UI is not an authorization boundary.
- Tenant-scoped queries must be tested for cross-workspace leakage. PostgreSQL Row-Level Security can be enabled as a second guard after repository scoping is in place.

## 6. Runtime boundaries

### HTTP and sessions
- Same-origin deployment: browser and API share the app origin; API is under `/api/v1`, Better Auth under `/api/auth`.
- Better Auth uses database-backed, HttpOnly, Secure-in-production cookies. Browser requests use `credentials: "include"`; no long-lived bearer token is placed in localStorage.
- OAuth credentials and all provider keys are environment secrets. Local use is supported with `.env`; production uses the host's secret store.
- CORS is allowlist-only if a separate web origin is ever introduced.

### Realtime
- Socket.IO authenticates the Better Auth session during handshake.
- The server derives workspace rooms from verified membership; clients cannot join arbitrary workspace IDs.
- Persist first, publish second. Events are emitted only after the database transaction commits.
- On reconnect, the client refetches authoritative state. Realtime is a notification channel, not the record of truth.
- The default single-instance deployment needs no Redis. If multi-instance deployment is later required, use a supported Socket.IO adapter (PostgreSQL or Redis) and sticky sessions where required.

### Storage
- Development: local persistent volume, generated opaque object keys, file size/type allowlists.
- Production: S3-compatible object API behind the same `StorageService` interface.
- Download URLs are short-lived and generated only after an authorization check.
- No public bucket or permanent public attachment URL by default.

### AI
- Gemini requests are made only from server integration modules.
- The browser sends a bounded image or text payload; the API checks size, MIME type, rate limits, membership, and usage.
- Provider model and key are configuration, not hardcoded constants.
- A provider interface keeps future model changes out of the incident domain.

### Notifications and scheduled work
- In-app notifications are persisted in PostgreSQL.
- Live notification indicators are delivered over Socket.IO.
- Browser push is implemented using Web Push/VAPID; optional email uses SMTP configuration.
- SLA scans, escalations, and cleanup execute as PostgreSQL-backed background jobs with idempotency keys and retry policies.

## 7. Security and quality requirements

- TypeScript strict mode; no `any` for new domain/API code.
- Zod validation for all request bodies, query parameters, and environment variables.
- Password/OAuth/session management delegated to Better Auth; authorization remains in domain services.
- Workspace scoping enforced in server repositories; avoid raw tenant IDs from request bodies.
- Rate limits for authentication, invite redemption, AI extraction, and uploads.
- CSRF protection for cookie-authenticated state-changing requests; origin checks and secure cookie settings.
- Audit logs are append-only through application permissions.
- Upload validation, opaque storage keys, private downloads, and explicit size limits.
- Structured logs with request ID and actor/workspace identifiers; never log session tokens, secrets, or image contents.
- Unit tests for business rules, integration tests against real PostgreSQL, and Playwright tests for sign-in, incident CRUD, quick updates, role restrictions, and workspace isolation.
- CI runs lint, typecheck, tests, and production build.

## 8. Deployment target

Initial production target is a portable Node.js deployment without a mandatory container runtime:
1. Web assets served from the same Node application or a static server.
2. Hono API + Socket.IO in one Node 26 process.
3. PostgreSQL 18 as a native service or managed PostgreSQL database, with persistent storage and scheduled backups.
4. Local or S3-compatible attachment storage.
5. Environment-based OAuth, Gemini, SMTP, and VAPID configuration.

The app must run locally on Windows with native PostgreSQL + npm and must not require Docker, Docker Compose, WSL2, AppDeploy, Firebase, or a vendor-specific database/storage SDK. CI may provision its own PostgreSQL test service on the hosted runner; that is not a developer-machine dependency.

## 9. External references

- [Node.js release schedule](https://github.com/nodejs/Release)
- [React releases](https://react.dev/versions)
- [Vite supported releases](https://vite.dev/releases)
- [Hono documentation](https://hono.dev/docs)
- [Better Auth releases and security notices](https://better-auth.com/changelog)
- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [PostgreSQL version policy](https://www.postgresql.org/support/versioning/)
- [PostgreSQL Windows installer](https://www.postgresql.org/download/windows/)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [TanStack Router](https://tanstack.com/router/latest/docs/overview)
- [Socket.IO PostgreSQL adapter](https://socket.io/docs/v4/postgres-adapter)
