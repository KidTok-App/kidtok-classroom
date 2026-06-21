import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const isBrowser = typeof window !== "undefined";
const hasConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function ensureApp(): FirebaseApp {
  if (!isBrowser) {
    throw new Error("Firebase is only available in the browser");
  }
  if (!hasConfig) {
    throw new Error(
      "Firebase config missing. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID in your environment."
    );
  }
  if (!_app) {
    _app = getApps().length === 0 ? initializeApp(firebaseConfig as Required<typeof firebaseConfig>) : getApp();
  }
  return _app;
}

// Lazy proxies — safe to import during SSR; only throw if actually used on the server
// or when config is missing on the client.
export const app = new Proxy({} as FirebaseApp, {
  get(_t, prop) {
    const target = ensureApp() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as Function).bind(target) : value;
  },
});

export const auth = new Proxy({} as Auth, {
  get(_t, prop) {
    if (!_auth) _auth = getAuth(ensureApp());
    const target = _auth as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as Function).bind(_auth) : value;
  },
});

export const db = new Proxy({} as Firestore, {
  get(_t, prop) {
    if (!_db) _db = getFirestore(ensureApp());
    const target = _db as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as Function).bind(_db) : value;
  },
});

export const isFirebaseConfigured = hasConfig;
