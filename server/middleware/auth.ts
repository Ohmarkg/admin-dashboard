import { createMiddleware } from "hono/factory";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "@/server/firebaseAdmin";

// Binary auth gate (CLAUDE.md rule 5): a valid Firebase ID token with ANY
// recognized custom claim grants full access. No per-route role tiers.
const RECOGNIZED_CLAIMS = [
    "admin",
    "officer",
    "developer",
    "lead",
    "representative",
] as const;

export type AuthVariables = {
    user: DecodedIdToken;
    /** The raw (already-verified) Bearer ID token — forwarded verbatim to
     * callable Cloud Functions so they authorize the same officer account
     * (server/lib/cloudFunctions.ts). */
    idToken: string;
};

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(
    async (c, next) => {
        const header = c.req.header("Authorization");
        if (!header || !header.startsWith("Bearer ")) {
            return c.json(
                {
                    error: {
                        code: "unauthenticated",
                        message: "Missing or malformed Authorization header.",
                    },
                },
                401
            );
        }

        const token = header.slice("Bearer ".length).trim();
        let decoded: DecodedIdToken;
        try {
            decoded = await adminAuth.verifyIdToken(token);
        } catch {
            return c.json(
                {
                    error: {
                        code: "invalid_token",
                        message: "The provided ID token is invalid or expired.",
                    },
                },
                401
            );
        }

        const hasRecognizedClaim = RECOGNIZED_CLAIMS.some(
            (claim) => !!decoded[claim]
        );
        if (!hasRecognizedClaim) {
            return c.json(
                {
                    error: {
                        code: "unauthorized",
                        message:
                            "This account does not have a recognized admin role.",
                    },
                },
                403
            );
        }

        c.set("user", decoded);
        c.set("idToken", token);
        await next();
    }
);
