# NOC Incident Desk — Firebase Spark Development

This branch migrates NOC Incident Desk from AppDeploy to Firebase Spark. It is still a migration branch: the existing AppDeploy database is not modified or imported automatically.

## Non-negotiable billing boundary

Use the Firebase **Spark** plan only. Do not attach a Cloud Billing account or upgrade the project to Blaze.

This branch does not deploy or require:
- Cloud Functions or Cloud Run
- Cloud Storage for Firebase
- PostgreSQL, Docker, or WSL2
- SMTP delivery or scheduled backend jobs
- A shared server-side Gemini key

The current Spark implementation uses Firebase Authentication, Cloud Firestore, Firebase Hosting, Firestore Security Rules, and the local Emulator Suite.

## 1. Create and configure the Firebase project

In the Firebase Console:

1. Create or select the Firebase project. Keep it on Spark and do not add a billing account.
2. Register a Web App in Project settings.
3. In Authentication > Sign-in method, enable **Email/Password** and **Google**.
4. Keep Firebase email verification enabled. New email/password registrations receive a verification link and cannot create or access a workspace until verified. The login screen also provides password-reset email.
5. In Firestore Database, create the default database. Choose **Jakarta `asia-southeast2`** before provisioning. Firestore's location cannot be changed after creation.
6. Do not create a Cloud Storage bucket.
7. Copy the Web App config values into `source/.env` as shown below.

The Firebase web config (including the API key) identifies the app and project; it is not a server secret. Access control is enforced by Authentication and Firestore Security Rules. Never put service-account JSON, Admin SDK credentials, Gemini secrets, or other private keys in `VITE_*` variables.

## 2. Windows prerequisites

- Node.js 26 LTS
- npm 10.8 or newer
- Java Development Kit 21 or newer for Firebase Emulator Suite
- Firebase CLI (installed in this project as a development dependency)

Check the installed tools:

```powershell
node --version
npm --version
java -version
```

Docker Desktop, Docker Engine, Docker Compose, PostgreSQL, and WSL2 are not required.

## 3. Configure local environment

Run from the `source` directory:

```powershell
Copy-Item .env.example .env
```

For local emulator use, leave `VITE_USE_FIREBASE_EMULATORS=true`. The code uses the demo project ID `demo-noc-incident-desk` and fake client configuration while connecting Auth and Firestore to localhost.

For direct connection to your real Spark project, set `VITE_USE_FIREBASE_EMULATORS=false` and fill in the values from Firebase Console:

```dotenv
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your-web-app-id
VITE_USE_FIREBASE_EMULATORS=false
```

Do not commit `.env` or `.firebaserc`.

## 4. Run locally with the Emulator Suite

Open two PowerShell terminals in the `source` directory.

Terminal A:

```powershell
npm install
npm run emulators
```

Terminal B:

```powershell
npm run dev
```

Open the Vite URL shown in the terminal (normally http://localhost:5173). The Auth emulator uses port 9099 and Firestore emulator uses port 8080. Emulator data is isolated from the production Firebase project.

To run the automated Firestore Security Rules tests:

```powershell
npm run test:rules
```

The test command starts the Firestore emulator for the test run and shuts it down afterward.

## 5. Select a deployment project locally

Authenticate the Firebase CLI and select your existing Spark project:

```powershell
npx firebase login
npx firebase use --add
```

Choose the intended Firebase project from the interactive list. This creates a local `.firebaserc` file, which is intentionally ignored by Git. Do not add it to source control.

Before deploying, verify the selected project:

```powershell
npx firebase projects:list
npx firebase use
```

## 6. Deploy only Spark-compatible resources

From the `source` directory:

```powershell
npm run deploy:firebase
```

This script builds the SPA and deploys only:
- Firebase Hosting
- Firestore Security Rules
- Firestore indexes

It must not deploy Functions or Storage. Keep the Firebase project on Spark.

## 7. Current feature boundaries

The Spark implementation is being migrated in phases. Current code has an initial Firebase Auth flow, Firestore workspace/incident repository, role-aware Rules, emulator tests, and a compatibility adapter for the existing UI.

Features that still require more work or are deliberately unavailable in Spark-only mode:
- Shared file attachments (Firebase Storage requires Blaze)
- Server-side Gemini extraction and Copilot
- SMTP email and server-originated push delivery
- Client-side SLA notices while the app is active (due-soon, overdue, L2/L3; browser permission is optional)
- Background SLA schedules and scheduled notifications (not supported in Spark-only mode; client-side SLA notices work only while the app remains active)
- Full Operations alert engine, Risk Radar, and Reliability Analytics parity
- Full-text search beyond bounded Firestore queries
- Complete AppDeploy export/import and rollback rehearsal

Do not treat placeholder responses or disabled controls as completed migrations. The UI must label unavailable features accurately.

## 8. Data migration and production safety

The Firestore database starts empty. AppDeploy users, workspaces, members, incidents, timeline history, audit/version records, route master data, and attachments are not imported by this branch.

Keep the current AppDeploy deployment and its data intact until:
1. An export/backup has been produced and can be restored.
2. An idempotent importer has been implemented and tested against a copy.
3. Workspace/member/incident/progress/version/audit/route-master counts and key fields have been compared.
4. Firestore Security Rules have passed emulator tests for Admin, Supervisor, Operator, invited users, and unauthenticated users.
5. A rollback procedure has been rehearsed.

Keep the migration PR in draft until the full workflow regression and migration checks are reviewed. Production cutover requires separate explicit approval.

## Official references

- [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Cloud Firestore quotas and limits](https://docs.cloud.google.com/firestore/quotas)
- [Firestore locations](https://firebase.google.com/docs/firestore/locations)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Firebase Local Emulator Suite installation](https://firebase.google.com/docs/emulator-suite/install_and_configure)
- [Firebase Hosting deployment](https://firebase.google.com/docs/hosting)
- [Cloud Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)


## 9. Permanent deletion in Spark-only mode

Permanent incident deletion is intentionally disabled while this project runs as a client-only Firebase Spark application. Firestore Security Rules can authorize a document delete by role, but cannot enumerate arbitrary child collections to prove that audit and version history have been fully removed. A client-side multi-batch cascade can fail partway through and leave orphaned records.

Incidents can still be moved to Trash and restored. The permanent-delete action remains disabled, and Firestore Rules deny direct incident, audit, and version deletion for every role. Re-enable hard deletion only after introducing a trusted purge mechanism that can enumerate and delete all child collections, handle retries, and verify completion before deleting the incident and releasing its identifier.
