import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getDatabase, onValue, ref, type Database } from 'firebase/database';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const firebaseEnabled = Boolean(config.apiKey && config.databaseURL && config.projectId);

export let serverOffset = 0;
export function serverNow() {
  return Date.now() + serverOffset;
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Database | undefined;
let timeOffsetSubscribed = false;

export async function firebaseClient() {
  if (!firebaseEnabled) throw new Error('Multiplayer is not configured. Add the VITE_FIREBASE_* settings.');

  app ??= initializeApp(config);
  auth ??= getAuth(app);
  db ??= getDatabase(app);

  if (!timeOffsetSubscribed) {
    timeOffsetSubscribed = true;
    onValue(ref(db, '.info/serverTimeOffset'), (s) => {
      serverOffset = s.val() ?? 0;
    });
  }

  await auth.authStateReady();

  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  return { auth, db, uid: auth.currentUser!.uid };
}
