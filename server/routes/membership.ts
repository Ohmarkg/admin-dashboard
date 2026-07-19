/**
 * Membership routes (BUILD_PLAN M1) — /api/membership
 *
 * Approve/deny a pending `memberSHPE/{uid}` request (DATA_MODEL.md invariant
 * 3): the user-doc expiration update + request-doc delete are one atomic
 * `adminDb.batch()`. The `sendNotificationMemberSHPE` Cloud Function is only
 * invoked AFTER the batch commits successfully — the Firestore write is the
 * source of truth, so a CF failure does not fail the request; it is logged
 * and surfaced as a non-fatal `warning` on the response.
 */

import { Hono } from "hono";
import { z } from "zod";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firebaseAdmin";
import type { AuthVariables } from "@/server/middleware/auth";
import { sendNotificationMemberSHPE } from "@/server/lib/cloudFunctions";

export const membershipRouter = new Hono<{ Variables: AuthVariables }>();

// Optional approve-time override (parity with mobile MemberSHPEConfirm's
// "Adjust National Expiration Date"). Only nationalExpiration is overridable —
// mobile offers no chapterExpiration adjustment, so the web doesn't either
// (API.md). Body is optional; an empty/absent body approves with the
// request's own expirations, as before.
const approveBodySchema = z
    .object({
        nationalExpiration: z
            .object({ seconds: z.number(), nanoseconds: z.number() })
            .optional(),
    })
    .optional();

membershipRouter.post("/:uid/approve", async (c) => {
    const uid = c.req.param("uid");

    const rawBody = await c.req.json().catch(() => undefined);
    const parsedBody = approveBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
        return c.json(
            {
                error: {
                    code: "validation_error",
                    message: "Invalid request body.",
                    details: parsedBody.error.issues,
                },
            },
            400
        );
    }
    const override = parsedBody.data?.nationalExpiration;

    const requestRef = adminDb.doc(`memberSHPE/${uid}`);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
        return c.json(
            {
                error: {
                    code: "request_not_found",
                    message: `No pending membership request for uid ${uid}.`,
                },
            },
            404
        );
    }

    const requestData = requestSnap.data() ?? {};
    const userRef = adminDb.doc(`users/${uid}`);

    const batch = adminDb.batch();
    batch.set(
        userRef,
        {
            chapterExpiration: requestData.chapterExpiration,
            nationalExpiration: override
                ? new Timestamp(override.seconds, override.nanoseconds)
                : requestData.nationalExpiration,
        },
        { merge: true }
    );
    batch.delete(requestRef);
    await batch.commit();

    let warning: string | undefined;
    try {
        await sendNotificationMemberSHPE({ uid, type: "approved", idToken: c.get("idToken") });
    } catch (error) {
        console.error(`sendNotificationMemberSHPE(approved) failed for uid ${uid}:`, error);
        warning = "Membership approved, but the mobile notification failed to send.";
    }

    return c.json(warning ? { ok: true, warning } : { ok: true }, 200);
});

membershipRouter.post("/:uid/deny", async (c) => {
    const uid = c.req.param("uid");

    const requestRef = adminDb.doc(`memberSHPE/${uid}`);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
        return c.json(
            {
                error: {
                    code: "request_not_found",
                    message: `No pending membership request for uid ${uid}.`,
                },
            },
            404
        );
    }

    const userRef = adminDb.doc(`users/${uid}`);

    const batch = adminDb.batch();
    batch.set(
        userRef,
        {
            chapterExpiration: FieldValue.delete(),
            nationalExpiration: FieldValue.delete(),
        },
        { merge: true }
    );
    batch.delete(requestRef);
    await batch.commit();

    let warning: string | undefined;
    try {
        await sendNotificationMemberSHPE({ uid, type: "denied", idToken: c.get("idToken") });
    } catch (error) {
        console.error(`sendNotificationMemberSHPE(denied) failed for uid ${uid}:`, error);
        warning = "Membership denied, but the mobile notification failed to send.";
    }

    return c.json(warning ? { ok: true, warning } : { ok: true }, 200);
});
