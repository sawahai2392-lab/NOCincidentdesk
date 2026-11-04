import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const useEmulators =
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';

const projectId =
  import.meta.env.VITE_FIREBASE_PROJECT_ID ||
  (useEmulators ? 'demo-noc-incident-desk' : '');

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (useEmulators ? 'demo-api-key' : ''),
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    (useEmulators ? `${projectId}.firebaseapp.com` : ''),
  projectId,
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    (useEmulators ? '1:123456789:web:firebase-emulator' : ''),
};

const missingConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
  .map(([key]) => key);

if (missingConfig.length > 0) {
  throw new Error(
    `Firebase configuration is incomplete. Set: ${missingConfig.join(', ')} in source/.env.`,
  );
}

export const firebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);

if (useEmulators) {
  connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', {
    disableWarnings: true,
  });
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
}
