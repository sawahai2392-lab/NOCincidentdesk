# NOC Incident Desk — Firebase Spark Migration Plan

**Target branch:** `feat/firebase-spark-migration`  
**Base branch:** `feat/tt-editor-quick-updates`  
**Billing rule:** Spark only; no billing account, Cloud Functions, or Cloud Storage.

## Phase 0 — Preserve existing work

- Keep the TT Editor / Quick Update branch as the source baseline.
- Do not merge the PostgreSQL standalone migration PR.
- Do not modify or delete the AppDeploy project or its data.
- Export the existing AppDeploy collections/tables and attachment metadata before data migration.

**Exit:** feature inventory and restorable export are available.

## Phase 1 — Firebase foundation

- Add the Firebase JavaScript SDK.
- Add environment-driven Firebase client initialization.
- Add Firebase Hosting configuration for the Vite SPA.
- Add Firestore Security Rules and composite indexes.
- Add Auth + Firestore Emulator Suite configuration.
- Add Auth provider UI for email/password and Google.
- Add CI for build and Firestore Rules tests.

**Exit:** a new Firebase Spark project can serve the SPA, authenticate users, and pass emulator security tests without paid services.

## Phase 2 — Identity and workspace

- Replace AppDeploy session state with Firebase Auth.
- Add Firestore user profile and workspace membership repositories.
- Add Admin/Supervisor/Operator authorization rules.
- Implement invitation flow with email-bound, expiring, one-time invite records.
- Add workspace bootstrap and account recovery flows.

**Exit:** login, logout, initial workspace creation, member listing, role changes, and invite redemption work with emulator and Spark project.

## Phase 3 — Incident domain

- Replace legacy API data calls with Firestore repositories.
- Model incidents, progress, audit entries, versions, cut points, and settings as bounded documents/subcollections.
- Implement transactional updates with revision checks.
- Preserve status transition, closure checklist, reopen, trash/restore, and immutable timeline rules.
- Add indexed filters and cursor pagination.
- Implement route-master import using browser XLSX parsing and bounded Firestore write batches.

**Exit:** the core NOC lifecycle works with Firestore and emulator-tested role isolation.

## Phase 4 — Spark-compatible feature replacements

- Replace Socket.IO with Firestore listeners.
- Replace server-computed SLA state with client-side calculations and in-app notices while the app is open.
- Replace server file uploads with local-only image processing and local IndexedDB drafts; shared file attachments remain disabled.
- Replace server-side Gemini extraction with manual coordinate review/local processing. Do not expose a shared Gemini key in the client bundle.
- Replace email/push sender workflows with in-app notifications. FCM may be reconsidered only when a trusted sender exists.
- Add manual export/import for backup and migration.

**Exit:** all enabled features work without Functions, Storage, SMTP, Cloud Run, or another paid backend.

## Phase 5 — Controlled pilot and cutover

- Create a Firebase Spark project and select Jakarta `asia-southeast2` before provisioning Firestore.
- Configure email/password and Google sign-in.
- Deploy Hosting, Rules, and indexes.
- Run a dry-run AppDeploy export/import and compare record counts and field integrity.
- Test workspace isolation as Admin, Supervisor, Operator, and unauthenticated user.
- Pilot with a small user group before moving production workflows.
- Keep the AppDeploy environment available for rollback until validation is complete.

**Exit:** a verified, Spark-only pilot is operational. Production cutover requires a separate explicit approval.

## Regression checklist

- Authentication: email/password, Google, logout, expired session, account recovery.
- Workspace: first-user bootstrap, invite expiry, invite reuse rejection, role update, member removal.
- Tenant isolation: direct reads/writes across another workspace are denied.
- Incidents: create, edit, duplicate prevention, status transition, close, reopen, trash, restore.
- Progress: quick-update templates, chronology, append-only rule, concurrent updates.
- History: audit creation, immutable snapshots, supervisor restore.
- Route master: XLSX parsing, batch writes, import progress, workspace isolation.
- Realtime: same-workspace update visible; cross-workspace update never visible.
- SLA: active tab notices; correct handling of browser sleep/closed state (no background guarantee).
- Offline: local draft persistence and conflict resolution on reconnect.
- Quota discipline: bounded listeners, list pagination, request counters, batch limits.
- Deployment: SPA routes resolve, Rules and indexes deploy, no Functions or Storage deploy target.

## Explicit non-goals while Spark-only

- Cloud Functions, Cloud Run, server-side API, or scheduled jobs.
- Firebase Cloud Storage or shared attachment binaries.
- Centralized server-side Gemini API key.
- SMTP sending or trusted server-originated push.
- Full-text search engine.
- Automated Firestore backups/PITR/restore services.

These non-goals can only be changed after reviewing the billing and architecture implications. Do not automatically upgrade the project to Blaze.
