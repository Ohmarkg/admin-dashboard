/**
 * Convention-tracking routes — /api/conventions
 *
 * Maintains the `convention-tracking/{uid}` roster of members tracked for
 * National Convention eligibility. This route only tracks/untracks membership
 * on the roster — per-category attendance counts and eligibility are derived
 * client-side from `users/{uid}/event-logs` joined to event types
 * (lib/hooks/useConventionTracker.ts; DATA_MODEL.md § convention-tracking);
 * nothing is stored beyond the per-uid tracking doc.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firebaseAdmin";
import {
    chunkedAtomicBatch,
    ChunkedBatchError,
    type BatchWriteOp,
} from "@/server/lib/db-helpers";

const trackBodySchema = z.object({
    uids: z.array(z.string().min(1)).min(1).max(500),
});

export const conventionsRouter = new Hono<{ Variables: { user: DecodedIdToken } }>();

conventionsRouter.post("/track", async (c) => {
    const parsed = trackBodySchema.safeParse(await c.req.json().catch(() => null));
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

    const user = c.get("user");
    const uids = [...new Set(parsed.data.uids)];

    const userRefs = uids.map((uid) => adminDb.doc(`users/${uid}`));
    const trackingRefs = uids.map((uid) => adminDb.doc(`convention-tracking/${uid}`));

    const snaps = await adminDb.getAll(...userRefs, ...trackingRefs);
    const userSnaps = snaps.slice(0, uids.length);
    const trackingSnaps = snaps.slice(uids.length);

    const unknownUids: string[] = [];
    const alreadyTracked: string[] = [];
    const toTrack: string[] = [];

    uids.forEach((uid, i) => {
        if (!userSnaps[i].exists) {
            unknownUids.push(uid);
        } else if (trackingSnaps[i].exists) {
            alreadyTracked.push(uid);
        } else {
            toTrack.push(uid);
        }
    });

    if (toTrack.length > 0) {
        const ops: BatchWriteOp[] = toTrack.map((uid) => ({
            ref: adminDb.doc(`convention-tracking/${uid}`),
            data: { dateAdded: Timestamp.now(), addedBy: user.uid },
        }));

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

    return c.json({ ok: true, tracked: toTrack, alreadyTracked, unknownUids }, 200);
});

conventionsRouter.post("/:uid/untrack", async (c) => {
    const uid = c.req.param("uid");
    // No 404 on missing doc (unlike the shirt-toggle 404) — untracking twice
    // is harmless and idempotent, so we don't require the doc to exist first.
    await adminDb.doc(`convention-tracking/${uid}`).delete();
    return c.json({ ok: true }, 200);
});
