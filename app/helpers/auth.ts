import { auth } from "@/config/firebaseClient";
import {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    signOut,
    User,
} from "firebase/auth";

// Client-side auth helpers. Reads-only (auth popup/session) — all privileged
// writes go through the Hono routes in server/. Never import server/ here.

/**
 * TAMU Google sign-in via popup, restricted to the tamu.edu hosted domain.
 * The `hd` param is only truly enforceable against a real Google account —
 * it's a no-op against the Auth emulator, so keep it for cutover.
 */
export const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
        hd: "tamu.edu",
        prompt: "select_account",
    });

    return signInWithPopup(auth, provider);
};

/**
 * Email/password sign-in — LOCAL DEV ONLY. Used against the Auth emulator so
 * the seeded officer account (shpe-officer@tamu.edu / testpassword) can sign
 * in without a real Google account. Only call this when
 * NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true'.
 */
export const signInWithEmulatorAccount = async (email: string, password: string) => {
    return signInWithEmailAndPassword(auth, email, password);
};

/**
 * Binary authorization gate: true if the ID token carries ANY recognized
 * custom claim. No role tiers — every recognized claim grants full access.
 */
export const checkHasRecognizedClaim = async (user: User): Promise<boolean> => {
    const idTokenResult = await user.getIdTokenResult();
    const claims = idTokenResult.claims;

    return Boolean(
        claims.admin ||
        claims.officer ||
        claims.developer ||
        claims.lead ||
        claims.representative
    );
};

export const signOutUser = async () => {
    return signOut(auth);
};
