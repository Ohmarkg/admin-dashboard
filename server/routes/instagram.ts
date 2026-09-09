/**
 * Instagram Points routes — /api/instagram
 *
 * Awards Wear-It-Wednesday participation points. Must stay byte-compatible
 * with the mobile app's `addInstagramPoints` callable (MobileApp
 * functions/src/events.ts): full-doc merge sets (NOT FieldValue.arrayUnion/
 * increment), dual write to `events/{eventId}/logs/{uid}` AND
 * `users/{uid}/event-logs/{eventId}`, timestamps appended to `instagramLogs`.
 *
 * `/revoke` is the web-only inverse (the mobile callable is award-only): it
 * pops the most recent `instagramLogs` timestamp and subtracts one award's
 * points, writing through the same dual-write shape.
 */

import { Hono } from "hono";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firebaseAdmin";
import {
    chunkedAtomicBatch,
    ChunkedBatchError,
    type BatchWriteOp,
} from "@/server/lib/db-helpers";

const INSTAGRAM_EVENT_NAME = "Instagram Points";

// 200 uids × 2 writes = 400 ≤ 500, so the chunked batch stays a single atomic batch.
const awardBodySchema = z.object({
    uids: z.array(z.string().min(1)).min(1).max(200),
});

const revokeBodySchema = awardBodySchema;

export const instagramRouter = new Hono();

/**
 * Deterministic pick among duplicate `"Instagram Points"` event docs: the
 * lexicographically-smallest doc id. Award and revoke MUST agree on this or a
 * revoke would edit a different event's logs than the award wrote to.
 */
function pickCanonicalEvent(
    docs: FirebaseFirestore.QueryDocumentSnapshot[]
): FirebaseFirestore.QueryDocumentSnapshot {
    return [...docs].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
}

/**
 * Idempotent get-or-create for the shared `"Instagram Points"` event (issue
 * #8). Runs in a Firestore transaction — the query read and the conditional
 * create commit atomically, so two concurrent first-awards cannot each create
 * an event (the emulator and production both lock the query's result range).
 *
 * Selection is deterministic: if duplicate docs already exist (mobile's
 * `limit(1)` + `.add()` path can race), every web award appends to the one
 * with the lexicographically-smallest doc id instead of whichever doc the
 * query happened to return first — no more silently splitting awards across
 * duplicates.
 */
async function getOrCreateInstagramEvent(): Promise<{ id: string; signInPoints: number }> {
    return adminDb.runTransaction(async (t) => {
        const snap = await t.get(
            adminDb.collection("events").where("name", "==", INSTAGRAM_EVENT_NAME)
        );

        if (!snap.empty) {
            const doc = pickCanonicalEvent(snap.docs);
            return { id: doc.id, signInPoints: doc.get("signInPoints") ?? 0 };
        }

        // Mirror the mobile app's createInstagramPointsEvent field set exactly.
        const today = new Date();
        const previousDay = new Date(today);
        previousDay.setDate(today.getDate() - 1);
        const nextYear = new Date(today);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        nextYear.setMonth(7);
        nextYear.setDate(1);

        const ref = adminDb.collection("events").doc();
        t.set(ref, {
            name: INSTAGRAM_EVENT_NAME,
            startTime: Timestamp.fromDate(previousDay),
            endTime: Timestamp.fromDate(nextYear),
            eventType: "Custom Event", // literal string; do NOT import client enum types into server code
            general: false,
            hiddenEvent: true,
            locationName: "Instagram",
            notificationSent: true,
            pointsPerHour: 0,
            signInPoints: 1,
            signOutPoints: 0,
        });

        return { id: ref.id, signInPoints: 1 };
    });
}

/**
 * Read-only counterpart to `getOrCreateInstagramEvent`, for revoke. Returns
 * `null` rather than creating the event: if no event exists there are no
 * awards, and creating one as a side effect of *removing* points would be
 * plainly wrong.
 */
async function findInstagramEvent(): Promise<{ id: string; signInPoints: number } | null> {
    const snap = await adminDb
        .collection("events")
        .where("name", "==", INSTAGRAM_EVENT_NAME)
        .get();

    if (snap.empty) return null;

    const doc = pickCanonicalEvent(snap.docs);
    return { id: doc.id, signInPoints: doc.get("signInPoints") ?? 0 };
}

instagramRouter.post("/award", async (c) => {
    const parsed = awardBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json(
            {
                error: {
                    code: "validation_error",
                    message: "Invalid request body.",
                    details: parsed.error.issues,
                },
            },
            400
        );
    }

    const uids = [...new Set(parsed.data.uids)];
    const event = await getOrCreateInstagramEvent();

    const userRefs = uids.map((uid) => adminDb.doc(`users/${uid}`));
    const logRefs = uids.map((uid) => adminDb.doc(`events/${event.id}/logs/${uid}`));

    const snaps = await adminDb.getAll(...userRefs, ...logRefs);
    const userSnaps = snaps.slice(0, uids.length);
    const logSnaps = snaps.slice(uids.length);

    const unknownUids: string[] = [];
    const awarded: string[] = [];
    const ops: BatchWriteOp[] = [];

    uids.forEach((uid, i) => {
        if (!userSnaps[i].exists) {
            unknownUids.push(uid);
            return;
        }

        const now = Timestamp.now();
        const logSnap = logSnaps[i];
        const log: Record<string, unknown> = logSnap.exists
            ? { ...logSnap.data()! }
            : {
                  uid,
                  eventId: event.id,
                  creationTime: now,
                  verified: true,
                  points: 0,
                  instagramLogs: [],
              };
        log.points = ((log.points as number | undefined) ?? 0) + event.signInPoints;
        log.instagramLogs = [...((log.instagramLogs as unknown[] | undefined) ?? []), now];

        ops.push(
            { ref: adminDb.doc(`events/${event.id}/logs/${uid}`), data: log, merge: true },
            { ref: adminDb.doc(`users/${uid}/event-logs/${event.id}`), data: log, merge: true }
        );
        awarded.push(uid);
    });

    if (ops.length > 0) {
        try {
            await chunkedAtomicBatch(ops);
        } catch (error) {
            if (error instanceof ChunkedBatchError) {
                return c.json(
                    {
                        error: {
                            code: "partial_batch_failure",
                            message: error.message,
                            details: {
                                failedChunkIndex: error.failedChunkIndex,
                                totalChunks: error.totalChunks,
                                batchesCommitted: error.batchesCommitted,
                                writesApplied: error.writesApplied,
                            },
                        },
                    },
                    500
                );
            }
            throw error;
        }
    }

    return c.json(
        {
            ok: true,
            eventId: event.id,
            awarded,
            unknownUids,
            pointsPerAward: event.signInPoints,
        },
        200
    );
});

/**
 * Removes the MOST RECENT Instagram award from each uid — the undo for an
 * award clicked on the wrong member. Deliberately not a "clear all awards"
 * operation: each click removes one award, so repeated weekly awards stay
 * individually correctable.
 *
 * Mirrors `/award`'s write shape exactly (full-doc merge sets, dual write to
 * `events/{eventId}/logs/{uid}` AND `users/{uid}/event-logs/{eventId}`) so the
 * mobile app's `addInstagramPoints` and this route stay compatible on the same
 * documents.
 */
instagramRouter.post("/revoke", async (c) => {
    const parsed = revokeBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json(
            {
                error: {
                    code: "validation_error",
                    message: "Invalid request body.",
                    details: parsed.error.issues,
                },
            },
            400
        );
    }

    const uids = [...new Set(parsed.data.uids)];
    const event = await findInstagramEvent();
    if (!event) {
        return c.json(
            {
                error: {
                    code: "instagram_event_not_found",
                    message:
                        "No Instagram Points event exists yet — there are no awards to remove.",
                },
            },
            404
        );
    }

    // The event-log doc is the source of truth: /award writes identical data
    // to both paths, so reading one is enough to compute the new state.
    const logRefs = uids.map((uid) => adminDb.doc(`events/${event.id}/logs/${uid}`));
    const logSnaps = await adminDb.getAll(...logRefs);

    const notAwarded: string[] = [];
    const revoked: string[] = [];
    const ops: BatchWriteOp[] = [];

    uids.forEach((uid, i) => {
        const logSnap = logSnaps[i];
        const existing = logSnap.exists ? { ...logSnap.data()! } : null;
        const instagramLogs = (existing?.instagramLogs as unknown[] | undefined) ?? [];

        if (!existing || instagramLogs.length === 0) {
            notAwarded.push(uid);
            return;
        }

        const remaining = instagramLogs.slice(0, -1);
        const points = Math.max(
            0,
            ((existing.points as number | undefined) ?? 0) - event.signInPoints
        );

        const eventLogRef = adminDb.doc(`events/${event.id}/logs/${uid}`);
        const userLogRef = adminDb.doc(`users/${uid}/event-logs/${event.id}`);

        // Removing the last award leaves a log carrying no information, which
        // would linger as a 0-award row on the tools table. Delete it instead
        // so the undo is complete — but only when the doc is a bare award log:
        // one that somehow acquired real attendance times is emptied, never
        // deleted.
        const isBareAwardLog = !existing.signInTime && !existing.signOutTime;
        if (remaining.length === 0 && points === 0 && isBareAwardLog) {
            ops.push({ ref: eventLogRef, delete: true }, { ref: userLogRef, delete: true });
        } else {
            const log = { ...existing, points, instagramLogs: remaining };
            ops.push(
                { ref: eventLogRef, data: log, merge: true },
                { ref: userLogRef, data: log, merge: true }
            );
        }

        revoked.push(uid);
    });

    if (ops.length > 0) {
        try {
            await chunkedAtomicBatch(ops);
        } catch (error) {
            if (error instanceof ChunkedBatchError) {
                return c.json(
                    {
                        error: {
                            code: "partial_batch_failure",
                            message: error.message,
                            details: {
                                failedChunkIndex: error.failedChunkIndex,
                                totalChunks: error.totalChunks,
                                batchesCommitted: error.batchesCommitted,
                                writesApplied: error.writesApplied,
                            },
                        },
                    },
                    500
                );
            }
            throw error;
        }
    }

    return c.json(
        {
            ok: true,
            eventId: event.id,
            revoked,
            notAwarded,
            pointsPerAward: event.signInPoints,
        },
        200
    );
});
