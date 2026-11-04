import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { firebaseAuth } from './firebase';

export interface NocAuthUser {
  userId: string;
  email: string;
  name: string;
  picture: string;
}

let persistencePromise: Promise<void> | null = null;

function ensurePersistence(): Promise<void> {
  persistencePromise ??= setPersistence(firebaseAuth, browserLocalPersistence);
  return persistencePromise;
}

export function mapAuthUser(user: User | null): NocAuthUser | null {
  if (!user) return null;
  return {
    userId: user.uid,
    email: user.email || '',
    name: user.displayName || user.email?.split('@')[0] || 'NOC User',
    picture: user.photoURL || '',
  };
}

export async function signInWithGoogle(): Promise<NocAuthUser> {
  await ensurePersistence();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(firebaseAuth, provider);
  return mapAuthUser(result.user)!;
}

export async function signInWithEmail(email: string, password: string): Promise<NocAuthUser> {
  await ensurePersistence();
  const result = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
  return mapAuthUser(result.user)!;
}

export async function registerWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<NocAuthUser> {
  await ensurePersistence();
  const result = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
  const displayName = name.trim().slice(0, 100) || email.split('@')[0];
  await updateProfile(result.user, { displayName });
  return mapAuthUser(result.user)!;
}

export async function getCurrentNocUser(): Promise<NocAuthUser | null> {
  await ensurePersistence();
  if (firebaseAuth.currentUser) return mapAuthUser(firebaseAuth.currentUser);
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (user) => {
        unsubscribe();
        resolve(mapAuthUser(user));
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

export async function getCurrentIdToken(): Promise<string | null> {
  await ensurePersistence();
  return firebaseAuth.currentUser ? firebaseAuth.currentUser.getIdToken() : null;
}

export async function signOutCurrentUser(): Promise<void> {
  await signOut(firebaseAuth);
}

export function observeAuthState(callback: (user: NocAuthUser | null) => void) {
  void ensurePersistence();
  return onAuthStateChanged(firebaseAuth, (user) => callback(mapAuthUser(user)));
}
