import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

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
let app: FirebaseApp | undefined; let auth: Auth | undefined; let db: Database | undefined;
export async function firebaseClient() { if (!firebaseEnabled) return null; app ??= initializeApp(config); auth ??= getAuth(app); db ??= getDatabase(app); if (!auth.currentUser) await signInAnonymously(auth); return { auth, db, uid: auth.currentUser!.uid }; }
