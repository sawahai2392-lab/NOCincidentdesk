# NOC Incident Desk — Firebase Spark Architecture

**Status:** Proposed implementation baseline  
**Decision date:** 2026-11-04  
**Branch:** `feat/firebase-spark-migration`  
**Billing constraint:** Firebase Spark only. Do not link a Cloud Billing account or use any service that requires Blaze.

## 1. Objective

Make NOC Incident Desk operate on Firebase's no-cost Spark plan with no Docker, PostgreSQL, AppDeploy, Cloud Functions, or paid Google Cloud backend dependency.

The product remains a React + Vite single-page application. Firebase is the managed platform:
- Firebase Hosting serves the production web app.
- Firebase Authentication provides email/password and Google sign-in.
- Cloud Firestore is the application database and realtime data channel.
- Firestore Security Rules enforce workspace membership and role-based access.
- Firebase Local Emulator Suite is used for local development and automated rules tests.

The app uses Firebase's browser SDK directly. There is no privileged server process in the Spark architecture. Never put Firebase Admin credentials, service-account keys, Gemini keys, SMTP credentials, or other secrets in browser code.

## 2. Spark-plan guardrails

The architecture must stay inside these boundaries:

| Capability | Spark availability | Design decision |
|---|---|---|
| Firebase Authentication | Most sign-in methods are no-cost | Use email/password and Google provider; no phone/SMS login |
| Cloud Firestore | Free quota: 1 GiB stored, 50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day, 10 GiB outbound/month | One default database, regional location in Jakarta, cost-aware query/listener design |
| Firebase Hosting | No-cost quota: 10 GiB stored content and 10 GiB data transfer/month | Host only the compiled SPA and small static assets |
| Cloud Messaging (FCM) | No-cost product | Do not add client-side server credentials; push sending requires a trusted sender |
| Cloud Functions | Not available on Spark | No Cloud Functions, callable functions, scheduled functions, or triggers |
| Cloud Storage for Firebase | Requires Blaze from 2026-02-03 | No Firebase Storage dependency or upload bucket |
| Other paid Google Cloud services | Not available on Spark | No Cloud Run, Pub/Sub, Cloud Scheduler, Secret Manager, or paid server APIs |

If a paid-service requirement is discovered, stop and redesign it. Do not add a billing account or silently switch the project to Blaze.

Spark quota exhaustion can disable the affected product until the next quota reset. Firestore's free quota is shared by all apps in the Firebase project. Monitor usage from day one and design to avoid unbounded listeners, full-collection scans, and repeated writes.

## 3. Product architecture

```text
Browser
  React + Vite
  ├─ Firebase Auth SDK
  ├─ Cloud Firestore SDK
  │    ├─ tenant-scoped documents
  │    ├─ transactions / batched writes
  │    └─ onSnapshot realtime listeners
  ├─ IndexedDB
  │    └─ local drafts and temporary image processing only
  └─ browser APIs
       ├─ Clipboard / downloads
       ├─ Notifications while app is open
       └─ Canvas / local image processing

Firebase Spark
  ├─ Firebase Hosting
  ├─ Firebase Authentication
  └─ Cloud Firestore + Security Rules + Indexes

Local development / CI
  └─ Firebase Local Emulator Suite (no Docker requirement)
```

## 4. Feature mapping

| Current capability | Firebase Spark implementation |
|---|---|
| AppDeploy authentication | Firebase Authentication email/password + Google |
| Workspace / members | Firestore workspace and membership documents |
| Admin / Supervisor / Operator roles | Membership documents enforced by Firestore Rules |
| Incident create/edit/status | Firestore transactions with validation and revision checks |
| Progress timeline | Separate append-only progress documents |
| Quick Update templates | Workspace settings document |
| Incident audit trail | Append-only audit subcollection |
| Version history / restore | Immutable version documents; restore creates a new revision |
| Route Master Excel import | Parse XLSX in browser; write bounded chunks in batches |
| Realtime updates | Firestore `onSnapshot`; no Socket.IO |
| SLA dashboard | Client-side SLA calculations while the app is open |
| SLA scheduled reminders | No background scheduler on Spark; in-app reminders while app is active |
| Browser notification | Only local notifications while the user has the app open; server-originated push is out of scope |
| Attachments | No shared cloud upload in Spark-only mode; local IndexedDB preview/draft only |
| Geotag coordinates | Manual coordinate entry and browser-local image processing; no image upload |
| Gemini / AI extraction | No shared server-side Gemini key. Keep AI extraction disabled unless a safe per-user bring-your-own-key flow is explicitly designed |
| Email invitations | Authenticated users can join through an admin-managed invitation workflow; no SMTP sender on Spark |
| Search | Firestore indexed filters (TT ID, status, date, severity, group); no full-text search service |
| Data backup | Manual export/import and controlled version history; no paid scheduled Firestore backups |
| Deployment | Firebase Hosting only |

Feature limitations are deliberate, not accidental omissions. Reintroducing shared file uploads, server-side AI, SMTP, scheduled backend jobs, or trusted push delivery requires a separately approved trusted backend or a change to the strict Spark-only constraint.

## 5. Firestore data model

Use one default Firestore database. Every query and every tenant-owned document is scoped to a workspace.

Suggested structure:

```text
users/{uid}
  private profile fields

workspaces/{workspaceId}
  workspace metadata

workspaces/{workspaceId}/members/{uid}
  role, email, displayName, status, joinedAt

workspaces/{workspaceId}/settings/main
  groups, PIC lists, root causes, actions, templates, SLA thresholds

workspaces/{workspaceId}/incidents/{incidentId}
  core fields, status, severity, revision, timestamps, assignment

workspaces/{workspaceId}/incidents/{incidentId}/progress/{progressId}
  immutable timeline event

workspaces/{workspaceId}/incidents/{incidentId}/audit/{auditId}
  immutable audit event

workspaces/{workspaceId}/incidents/{incidentId}/versions/{versionId}
  immutable snapshot

workspaces/{workspaceId}/incidents/{incidentId}/cutPoints/{cutPointId}
  label and verified coordinate

workspaces/{workspaceId}/routeMasterBatches/{batchId}
  import metadata

workspaces/{workspaceId}/routeMasterBatches/{batchId}/chunks/{chunkId}
  bounded arrays of systemKey / routeSegment pairs

workspaces/{workspaceId}/notifications/{notificationId}
  in-app notification
```

Do not store unbounded arrays (progress, audit, versions, route master) in the incident document. Keep each document comfortably below Firestore's 1 MiB document limit. Add only required composite indexes.

## 6. Authorization and data integrity

Firestore Security Rules are the security boundary because there is no trusted application server in the Spark design.

Required rule principles:
- Unauthenticated users cannot read workspace data.
- A user can read a workspace only when their UID has an active membership document.
- A user can only access workspaces where they are a member.
- Admin/Supervisor/Operator permissions are checked in rules, not merely hidden in the UI.
- Operators cannot change member roles, workspace settings, or admin-only fields.
- Audit, progress, and version records are append-only from the client: create allowed under role checks, update/delete denied.
- Membership creation and invite redemption must verify the authenticated user's email and the invitation state/expiry.
- Users cannot assign a role higher than their own.
- Incident writes validate allowed fields, value types, status transitions, revision progression, and workspace identity.
- Use Firestore transactions/batched writes for incident + audit + progress changes.
- Do not allow clients to write arbitrary collection paths or use untrusted workspace IDs as authorization proof.

Security Rules cannot turn arbitrary client JavaScript into trusted backend code. Every invariant that matters must be represented in rules or a transaction whose writes are all checked by rules. If a rule cannot safely enforce a required operation, that operation must be deferred rather than trusted to the UI.

## 7. Cost and performance rules

- Use `limit()` and cursor pagination for incident lists.
- Do not attach broad realtime listeners to entire workspace collections.
- Subscribe only to the currently visible list/detail/settings data.
- Unsubscribe listeners when a view is closed or unmounted.
- Avoid loading full progress/version/audit history until the user opens it.
- Store progress, audit, cut points, and snapshots as separate documents.
- Batch Excel route-master imports in bounded chunks and expose a progress report.
- Do not poll Firestore. Use listeners for active views and one-shot reads elsewhere.
- Avoid duplicate reads when switching tabs; use a bounded in-memory cache.
- Add development counters for reads, writes, listeners, and batch sizes.
- Export Firestore data manually before risky bulk changes; do not assume automated backups exist on Spark.

## 8. Local development and deployment

Local setup requires Node.js, npm, Firebase CLI, and Java for the local emulators. Docker is not required.

Target scripts:
- `npm run dev`: Vite dev server using Firebase Emulator Suite configuration.
- `npm run build`: production SPA build.
- `npm run emulators`: Auth + Firestore + Hosting emulators.
- `npm run test:rules`: rules unit tests against emulators.
- `npm run deploy`: Hosting, Firestore Rules, and indexes only.

Deployment must not run `firebase deploy --only functions` or configure a Storage bucket. Use the existing Firebase project ID supplied by the maintainer; do not create or guess a project ID in source control.

## 9. Firestore location

Recommended default database location: `asia-southeast2` (Jakarta), because the primary operational users are in Indonesia. The Firestore database location cannot be changed after provisioning. Confirm the project's default Google Cloud resource location before creating the database.

## 10. Cutover safeguards

- Keep the existing AppDeploy project and its data untouched until export/import verification and rollback rehearsal are complete.
- The existing PostgreSQL migration PR is not the target architecture. Do not merge it.
- Build a data exporter for workspaces, profiles, members, incidents, progress, audit/version history, route-master data, and metadata before cutover.
- Import into Firestore using an idempotent migration tool; validate record counts, per-workspace relationships, and critical incident fields.
- Reissue authentication invitations. AppDeploy sessions are not portable.
- Verify role isolation with emulator tests before any production user is moved.
- Treat the first Firestore release as a controlled pilot, not an automatic production cutover.

## 11. Official references

- [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firebase pricing](https://firebase.google.com/pricing)
- [Firestore quotas and limits](https://docs.cloud.google.com/firestore/quotas)
- [Cloud Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
- [Firebase Hosting quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
- [Firebase Authentication limits](https://firebase.google.com/docs/auth/limits)
- [Firestore locations](https://firebase.google.com/docs/firestore/locations)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite)
