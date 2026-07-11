/**
 * Cloud Function invocation layer (BUILD_PLAN S8).
 *
 * The real functions (`updateAllUserPoints`, `sendNotificationMemberSHPE`) live
 * in a separate repo and are NOT emulated locally (REBUILD_CONCEPT §9.2). On the
 * emulator these are dev stubs: log + canned success. The real invocation
 * mechanism (OIDC HTTP call vs trigger conversion vs inline — REBUILD_CONCEPT §4)
 * is chosen per function at cutover (X3) and replaces the stub bodies here.
 *
 * `zipResume` is deliberately NOT here — it stays a client `httpsCallable`
 * (the one client-side mutation-trigger exception; see API.md tools note), with
 * its own client dev stub in lib/hooks/useTools.ts.
 */

const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

/** Recalculates aggregate `points`/`pointsThisMonth` on all user docs. */
export async function updateAllUserPoints(): Promise<{ ok: true }> {
    if (isEmulator) {
        console.log("[cloudFunctions stub] updateAllUserPoints invoked (no-op on emulator)");
        return { ok: true };
    }
    // X3: replace with the real invocation (mechanism per REBUILD_CONCEPT §4).
    throw new Error("updateAllUserPoints is not wired for production yet (BUILD_PLAN X3)");
}

/** Push-notifies a member that their membership request was decided. */
export async function sendNotificationMemberSHPE(args: {
    uid: string;
    type: "approved" | "denied";
}): Promise<{ ok: true }> {
    if (isEmulator) {
        console.log(`[cloudFunctions stub] sendNotificationMemberSHPE invoked: ${JSON.stringify(args)}`);
        return { ok: true };
    }
    // X3: replace with the real invocation (mechanism per REBUILD_CONCEPT §4).
    throw new Error("sendNotificationMemberSHPE is not wired for production yet (BUILD_PLAN X3)");
}
