import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// SERVER-ONLY — never import this (or anything under server/) from a client
// component. Emulator-aware init guard per REBUILD_CONCEPT §9.3: no cert() when
// the emulator host env vars are present. The service-account branch stays
// unwired until cutover (X1), when FIREBASE_SERVICE_ACCOUNT_KEY (stringified
// JSON, server-only Vercel env var) is provisioned.
const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

function buildApp(): App {
    if (getApps().length) return getApps()[0];
    if (useEmulator) {
        return initializeApp({ projectId: "tamushpemobileapp" }); // emulator: no real credentials
    }
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
        throw new Error(
            "FIREBASE_SERVICE_ACCOUNT_KEY is not set and no emulator is configured. " +
                "Local dev must run against the Emulator Suite (FIRESTORE_EMULATOR_HOST); " +
                "production credentials are wired only at cutover (BUILD_PLAN X1)."
        );
    }
    return initializeApp({ credential: cert(JSON.parse(serviceAccountKey)) });
}

export const adminApp = buildApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
