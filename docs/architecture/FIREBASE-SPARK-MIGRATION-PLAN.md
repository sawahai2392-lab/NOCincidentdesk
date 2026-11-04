# NOC Incident Desk — Firebase Spark Migration Plan

**Target branch:** `feat/firebase-spark-migration`  
**Base branch:** `feat/tt-editor-quick-updates`  
**Billing rule:** Spark only; no billing account, Cloud Functions, or Cloud Storage.

## Implementation snapshot — 4 November 2026

- **Phase 1 — Foundation:** Implemented. Firebase SDK/config, Hosting, emulator configuration, default-deny-to-role-aware Firestore Rules, and CI are present. CI passed TypeScript typecheck, production build, and 11 Firestore Rules emulator tests on source commit `e9880239e2253d7a36ef4bfef32fb7025013d51f`.
- **Phase 2 — Identity/workspace:** Core flow implemented: email/password and Google Auth, email verification required before workspace access, password reset email, first Admin workspace bootstrap, role from active membership, email-bound expiring invitations, and re-invitation for removed members in the same workspace. Complete member-management and account-recovery regression coverage still needs browser-level testing.
- **Phase 3 — Incident domain:** Partial implementation: Firestore repositories, revision transactions, status transition checks, ID duplicate index, Trash/restore, audit/version subcollections, route-master batch import, and listeners exist. Full NOC feature parity and browser-level workflow regression remain. Progress currently lives inside incident documents and needs a size/retention strategy before larger production history is imported.
- **Phase 4 — Spark replacements:** Partial. Firestore listeners and explicit Spark-unavailable adapter responses exist. Client-side SLA notices are implemented for the active app session: due-soon, overdue, L2, and L3 thresholds are evaluated locally, deduplicated per incident/update/stage, and surfaced through in-app toast or browser notifications when permission is granted and the tab is hidden. The clock rechecks on visibility return. This is not a background scheduler and cannot guarantee notices when the browser/app is closed or suspended. Local offline draft behavior still needs full verification. Attachments, server-side AI, SMTP, and advanced analytics are not implemented.
- **Phase 5 — Pilot/cutover:** Not started. No AppDeploy export/import has occurred. Keep AppDeploy running and untouched.

The passing CI run verifies the code at the cited source commit. Subsequent changes to the CI trigger configuration are documentation/workflow-only; rerun status for the current PR head is the authoritative latest check. A green CI does not certify data migration or production readiness.

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
- [x] Replace server-computed SLA state with client-side calculations and in-app notices while the app is open (due-soon/overdue/L2/L3, deduplicated; active-tab/browser-permission only).
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
- SLA: active-tab notices for due-soon/overdue/L2/L3 are implemented and unit-tested; visibility return refreshes the clock. Browser closed/suspended state has no background guarantee.
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
