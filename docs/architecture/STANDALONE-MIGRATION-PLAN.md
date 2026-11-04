# NOC Incident Desk — Standalone Migration Plan

**Baseline:** \`feat/tt-editor-quick-updates\`  
**Migration branch:** \`feat/standalone-platform-migration\`  
**Rule:** keep the existing UI feature PR unmerged until the local build and regression checks pass. No PR is merged automatically.

## Current dependency map

The current source is not standalone:
- \`source/src/NocApp.tsx\` imports \`api\`, \`auth\`, \`image\`, \`invitesClient\`, \`notifications\`, and \`ws\` from \`@appdeploy/client\`.
- \`source/backend/index.ts\` imports \`router\`, \`json\`, \`error\`, \`requireAuth\`, \`db\`, \`storage\`, \`invites\`, \`secrets\`, \`notifications\`, and \`ai\` from \`@appdeploy/sdk\`.
- The backend exposes the existing incident, bootstrap, settings, member, invite, attachment, import, intelligence, reliability, route-master, and SLA operations.
- \`source/cron.json\` configures scheduled SLA processing in AppDeploy.
- \`source/package.json\` currently has Vite 6 and no dependency for \`@appdeploy/client\`; no package lock is committed at this path.

## Replacement map

| Existing AppDeploy capability | Standalone replacement |
|---|---|
| \`@appdeploy/client/api\` | Local typed \`fetch\` API client using same-origin cookies |
| \`@appdeploy/client/auth\` | Better Auth browser client and server session middleware |
| \`@appdeploy/client/image\` | Browser File/Canvas utilities; server image validation |
| \`@appdeploy/client/invitesClient\` | Local invite-code URL/session helper |
| \`@appdeploy/client/notifications\` | Persisted notifications + Web Push/VAPID |
| \`@appdeploy/client/ws\` | Socket.IO client |
| \`@appdeploy/sdk/router\` | Hono routers and middleware |
| \`@appdeploy/sdk/requireAuth\` | Better Auth session + workspace membership middleware |
| \`@appdeploy/sdk/db\` | PostgreSQL + Drizzle repositories |
| \`@appdeploy/sdk/storage\` | Local/S3-compatible \`StorageService\` |
| \`@appdeploy/sdk/invites\` | Workspace invitation table, hashed tokens, expiry, and email delivery |
| \`@appdeploy/sdk/secrets\` | Validated environment secrets / host secret store |
| \`@appdeploy/sdk/notifications\` | Web Push and in-app notification services |
| \`@appdeploy/sdk/ai\` | Direct Gemini provider adapter |
| AppDeploy cron | PostgreSQL-backed scheduled jobs |

## Phases and exit criteria

### Phase 0 — Preserve the current product
- Keep the feature branch and its open PR unchanged.
- Capture a verified export/backup of all AppDeploy database tables and attachment objects before cutover.
- Record current API request/response contracts and role behavior.
- Preserve the existing incident format, status transitions, immutable progress rules, audit trail, version restore, trash/purge, route master import, and quick update templates.

**Exit:** a restorable data export exists, and a route/feature inventory is checked into the repository.

### Phase 1 — Standalone platform foundation
- Add npm workspaces and a reproducible lockfile.
- Add the Node/Hono API entry point, environment validation, health endpoint, request IDs, structured logging, and graceful shutdown.
- Use native PostgreSQL 18 on Windows for local development; provide a PowerShell setup script that creates the local application role and database without Docker or WSL2.
- Add Drizzle schema/migrations for auth and workspace foundation.
- Add Better Auth with secure database-backed sessions.
- Add CI for install, typecheck, lint, tests, and build. CI may use a PostgreSQL service supplied by the hosted CI runner; developers do not need a local container runtime.

**Exit:** a fresh Windows development machine can install PostgreSQL natively, configure the local role/database, migrate the database, start the API, and pass health/auth smoke tests without Docker or AppDeploy.

### Phase 2 — Migrate domain and persistence
- Translate the existing AppDeploy table operations to typed Drizzle repositories.
- Create relational workspace, member, settings, incident, progress, impacts, cut-points, attachments, audit, versions, route-master, and notification tables.
- Implement transactions for incident saves, audit records, version snapshots, status changes, and event outbox writes.
- Add tenant-scope and role checks to every route.
- Implement the legacy data importer with dry-run, validation report, idempotency, and a rollback/restore procedure.

**Exit:** CRUD, status transitions, version restore, trash/purge, duplicate checks, search, pagination, and settings operate on PostgreSQL; migration tests verify record counts and key integrity.

### Phase 3 — Migrate platform integrations
- Implement local/S3-compatible file storage.
- Replace AppDeploy invitations with expiring, email-bound workspace invitations.
- Replace AppDeploy secrets with environment configuration.
- Replace Gemini extraction/copilot wrappers with direct server-side provider adapters.
- Replace AppDeploy realtime subscriptions with authenticated Socket.IO workspace rooms.
- Replace notification and cron integrations with persisted notifications, Web Push, and PostgreSQL-backed scheduled jobs.

**Exit:** no runtime code imports or calls AppDeploy SDKs or AppDeploy URLs.

### Phase 4 — Reconnect and modernize the frontend
- Replace the AppDeploy client import with a local platform client.
- Use Better Auth's browser client and cookie sessions.
- Use TanStack Query for server state and invalidation; TanStack Router for route definitions and search state.
- Move critical server data from component-local ad-hoc fetches into typed query hooks.
- Preserve the existing UI and CSS first; do not combine infrastructure migration with a large redesign.
- Add connection status, reconnect/refetch behavior, error boundaries, and safe offline draft recovery.

**Exit:** the existing NOC workflows run against the new API and do not need AppDeploy.

### Phase 5 — Cutover and hardening
- Run a dry-run migration against a copy of production data.
- Compare workspace/member/incident/progress/attachment/version/audit/route-master counts.
- Run Playwright smoke tests and permission/isolation tests.
- Take a final backup, perform one-time import, and verify attachments before changing the production URL.
- Keep a rollback window and documented restore steps.

**Exit:** production runs independently; backups can be restored; all AppDeploy-specific packages, cron configuration, secrets, and runtime bindings are removed.

## Required regression matrix

- Authentication: sign-in, sign-out, session expiry, unauthorized requests.
- Workspace: first-user bootstrap, invite create/resolve/join, email allowlist, member role update/removal.
- Incidents: create, update, duplicate, search, pagination, trash, restore, purge.
- Workflow: title required, optional fields, status transition permissions, closure checklist, recovery requirements.
- Progress: quick-update scenarios, milestone assignment, ordering, immutable edit/delete constraints.
- History: audit append, snapshot creation, supervisor restore.
- Attachments: upload limit, private URL, delete, purge cleanup.
- Route master: Excel parsing/import staging/commit and workspace isolation.
- AI: missing/invalid provider key, image limits, extraction failure, valid coordinate review.
- Realtime: workspace-only events, reconnect/refetch, no event before commit.
- Security: cross-workspace access denied, operator cannot perform admin actions, CSRF/origin checks, rate limits.

## Important cutover notes

- AppDeploy Auth identities/session tokens should not be assumed portable. Users will authenticate again through Better Auth; invitations may need to be reissued.
- Do not discard the AppDeploy workspace/database until export validation and backup restore have succeeded.
- Secrets are not copied from the old secret store into source control. Operators configure new environment values in the deployment secret store.
- Files are migrated separately from metadata; verify object counts and checksums.
- Keep the current open feature PR unmerged. The standalone branch is based on that branch so the TT editor/quick-update work is included in the migration lineage.
