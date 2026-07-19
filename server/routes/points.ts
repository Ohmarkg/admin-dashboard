/**
 * Points routes (BUILD_PLAN V2/V3) — /api/points
 *
 * Mirrors the legacy `updatePointsInFirebase` dual-write semantics exactly
 * (OLD-tamu-shpe-admin-web/app/api/firebaseUtils.ts): for each edit, write
 * `{ points, eventId, uid, edited: true, verified: true }` with
 * `set(..., { merge: true })` to BOTH `events/{eventId}/logs/{uid}` and
 * `users/{uid}/event-logs/{eventId}`. `creationTime`/`signInTime` are
 * backfilled from the event's `startTime` only if missing on the existing
 * log doc (checked independently per path). `points: null` is written
 * literally (log doc kept, points cleared).
 */

import { Hono } from "hono";
import { z } from "zod";
import { adminDb } from "@/server/firebaseAdmin";
import type { AuthVariables } from "@/server/middleware/auth";
import { updateAllUserPoints, CloudFunctionError } from "@/server/lib/cloudFunctions";
import {
    chunkedAtomicBatch,
    makeEventStartTimeGetter,
    EventNotFoundError,
    ChunkedBatchError,
    type BatchWriteOp,
} from "@/server/lib/db-helpers";

const editSchema = z.object({
    eventId: z.string().min(1),
    uid: z.string().min(1),
    points: z.number().nullable(),
});

const editsBodySchema = z.object({
    edits: z.array(editSchema).min(1),
});

export const pointsRouter = new Hono<{ Variables: AuthVariables }>();

pointsRouter.post("/edit", async (c) => {
    const parsed = editsBodySchema.safeParse(await c.req.json().catch(() => null));
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

    const { edits } = parsed.data;
    const getEventStartTime = makeEventStartTimeGetter();

    let ops: BatchWriteOp[];
    try {
        ops = await Promise.all(
            edits.map(async (edit) => {
                const eventStartTime = await getEventStartTime(edit.eventId);

                const eventLogRef = adminDb.doc(
                    `events/${edit.eventId}/logs/${edit.uid}`
                );
                const userEventLogRef = adminDb.doc(
                    `users/${edit.uid}/event-logs/${edit.eventId}`
                );

                const [existingEventLog, existingUserEventLog] = await Promise.all([
                    eventLogRef.get(),
                    userEventLogRef.get(),
                ]);

                const baseData = {
                    points: edit.points,
                    eventId: edit.eventId,
                    uid: edit.uid,
                    edited: true,
                    verified: true,
                };

                const eventLogData: Record<string, unknown> = { ...baseData };
                if (!existingEventLog.exists || !existingEventLog.get("creationTime")) {
                    eventLogData.creationTime = eventStartTime;
                }
                if (!existingEventLog.exists || !existingEventLog.get("signInTime")) {
                    eventLogData.signInTime = eventStartTime;
                }

                const userEventLogData: Record<string, unknown> = { ...baseData };
                if (
                    !existingUserEventLog.exists ||
                    !existingUserEventLog.get("creationTime")
                ) {
                    userEventLogData.creationTime = eventStartTime;
                }
                if (
                    !existingUserEventLog.exists ||
                    !existingUserEventLog.get("signInTime")
                ) {
                    userEventLogData.signInTime = eventStartTime;
                }

                return [
                    { ref: eventLogRef, data: eventLogData, merge: true },
                    { ref: userEventLogRef, data: userEventLogData, merge: true },
                ] as BatchWriteOp[];
            })
        ).then((pairs) => pairs.flat());
    } catch (error) {
        if (error instanceof EventNotFoundError) {
            return c.json(
                {
                    error: {
                        code: "event_not_found",
                        message: error.message,
                    },
                },
                404
            );
        }
        throw error;
    }

    try {
        const { batchesCommitted } = await chunkedAtomicBatch(ops);
        return c.json({ ok: true, edits: edits.length, batchesCommitted }, 200);
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
});

pointsRouter.post("/recalculate", async (c) => {
    try {
        await updateAllUserPoints({ idToken: c.get("idToken") });
    } catch (error) {
        // Surface CF failures as a structured 502 instead of an opaque 500 —
        // stale aggregates are an operational problem officers must see
        // (issue #2 acceptance: no silent throw).
        if (error instanceof CloudFunctionError) {
            return c.json(
                {
                    error: {
                        code: "cloud_function_error",
                        message: `Recalculation failed (${error.code}): ${error.message}. Aggregate points/ranks may be stale until a recalculation succeeds.`,
                    },
                },
                502
            );
        }
        throw error;
    }
    return c.json({ ok: true }, 200);
});
