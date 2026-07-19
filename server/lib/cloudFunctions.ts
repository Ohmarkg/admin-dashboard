/**
 * Cloud Function invocation layer (BUILD_PLAN S8, wired for production in X3).
 *
 * The real functions (`updateAllUserPoints`, `sendNotificationMemberSHPE`) live
 * in the MobileApp repo (functions/src) as **v1 callable** functions in the
 * shared Firebase project, default region us-central1. They are NOT emulated
 * locally (REBUILD_CONCEPT §9.2), so on the emulator these remain dev stubs:
 * log + canned success.
 *
 * Production mechanism (REBUILD_CONCEPT §4, option 1): call the function's
 * HTTPS endpoint directly using the **callable protocol** with the calling
 * officer's own Firebase ID token forwarded as the Bearer credential. This is
 * byte-equivalent to the mobile app's `httpsCallable` — the function sees the
 * same `context.auth` (uid + custom claims) it sees when invoked from mobile,
 * so its own claim checks keep working unchanged. Note the functions accept
 * the claims admin/officer/developer/secretary/representative — a web user
 * authorized only via the `lead` claim will get `permission-denied` here,
 * exactly as they would calling from mobile.
 *
 * `zipResume` is deliberately NOT here — it stays a client `httpsCallable`
 * (the one client-side mutation-trigger exception; see API.md tools note), with
 * its own client dev stub in lib/hooks/useTools.ts.
 */

const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

/** Base origin for the deployed callable functions. Override via env for
 * region/project changes without a code edit. */
const CLOUD_FUNCTIONS_ORIGIN =
    process.env.CLOUD_FUNCTIONS_ORIGIN ??
    "https://us-central1-tamushpemobileapp.cloudfunctions.net";

/** A callable Cloud Function returned an error (or was unreachable). `code`
 * is the callable-protocol status (e.g. "permission-denied", "internal") or
 * "unavailable" for transport failures. */
export class CloudFunctionError extends Error {
    constructor(
        public readonly functionName: string,
        public readonly code: string,
        message: string
    ) {
        super(`${functionName}: ${message}`);
        this.name = "CloudFunctionError";
    }
}

/**
 * Invokes a deployed v1 callable function over the callable HTTP protocol:
 * POST { data } with the officer's ID token as the Bearer credential.
 * Resolves with the function's `result`; throws `CloudFunctionError` on any
 * non-OK response or transport failure.
 */
async function callCallable(
    functionName: string,
    data: unknown,
    idToken: string
): Promise<unknown> {
    let res: Response;
    try {
        res = await fetch(`${CLOUD_FUNCTIONS_ORIGIN}/${functionName}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ data }),
        });
    } catch (error) {
        throw new CloudFunctionError(
            functionName,
            "unavailable",
            `Could not reach Cloud Function endpoint: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    const body = (await res.json().catch(() => null)) as {
        result?: unknown;
        error?: { message?: string; status?: string };
    } | null;

    if (!res.ok || body?.error) {
        throw new CloudFunctionError(
            functionName,
            body?.error?.status?.toLowerCase().replace(/_/g, "-") ??
                `http-${res.status}`,
            body?.error?.message ?? `Request failed with status ${res.status}`
        );
    }

    return body?.result;
}

/** Recalculates aggregate `points`/`pointsThisMonth` (and ranks) on all user
 * docs. Requires the calling officer's ID token — forwarded so the function's
 * own claim check authorizes the same account. */
export async function updateAllUserPoints(args: {
    idToken: string;
}): Promise<{ ok: true }> {
    if (isEmulator) {
        console.log("[cloudFunctions stub] updateAllUserPoints invoked (no-op on emulator)");
        return { ok: true };
    }
    await callCallable("updateAllUserPoints", {}, args.idToken);
    return { ok: true };
}

/** Push-notifies a member that their membership request was decided. */
export async function sendNotificationMemberSHPE(args: {
    uid: string;
    type: "approved" | "denied";
    idToken: string;
}): Promise<{ ok: true }> {
    if (isEmulator) {
        console.log(
            `[cloudFunctions stub] sendNotificationMemberSHPE invoked: ${JSON.stringify({ uid: args.uid, type: args.type })}`
        );
        return { ok: true };
    }
    await callCallable(
        "sendNotificationMemberSHPE",
        { uid: args.uid, type: args.type },
        args.idToken
    );
    return { ok: true };
}
