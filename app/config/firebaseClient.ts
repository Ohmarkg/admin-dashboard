import { initializeApp, FirebaseApp, getApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";

// PUBLIC client SDK config — safe to ship to the browser. Used for reads and the
// auth popup only; all writes go through the Hono routes (server/).
// The service-account init lives in server/firebaseAdmin.ts and must NEVER be
// imported from client code.
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
    authDomain: "tamushpemobileapp.firebaseapp.com",
    projectId: "tamushpemobileapp",
    storageBucket: "tamushpemobileapp.appspot.com",
    messagingSenderId: "600060629240",
    appId: "1:600060629240:web:1e97e43973746bcc266b0d",
};

// Everything through Phase 5 runs on the Emulator Suite — no real credentials
// (REBUILD_CONCEPT §9). The Auth emulator does not validate the API key, so a
// dummy NEXT_PUBLIC_GOOGLE_API_KEY suffices locally.
const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

let app: FirebaseApp;

if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

if (useEmulators) {
    // Emulators run on localhost from the browser's perspective (ports published
    // by docker-compose). Guard against double-connect across HMR reloads.
    const g = globalThis as { __emulatorsConnected?: boolean };
    if (!g.__emulatorsConnected) {
        connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
        connectFirestoreEmulator(db, "localhost", 8080);
        connectStorageEmulator(storage, "localhost", 9199);
        connectFunctionsEmulator(functions, "localhost", 5001);
        g.__emulatorsConnected = true;
    }
}

export { db, auth, storage, functions };
