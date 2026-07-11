/**
 * Events routes (BUILD_PLAN E1) — /api/events
 *
 * Create/update `events/{id}` and approve unverified `SHPEEventLog` docs.
 * Approve routes mirror the points dual-write pattern (canonical
 * `events/{id}/logs/{uid}` + mirror `users/{uid}/event-logs/{id}`), both set
 * in one atomic batch (API.md).
 *
 * Timestamps in request bodies are `{ seconds, nanoseconds }` (API.md
 * Conventions) and are converted to Admin-SDK `Timestamp`s here; geolocation
 * is `{ latitude, longitude }` converted to an Admin `GeoPoint`.
 */

import { Hono } from "hono";
import { z } from "zod";
import { Timestamp, GeoPoint } from "firebase-admin/firestore";
import { adminDb } from "@/server/firebaseAdmin";
import { chunkedAtomicBatch, type BatchWriteOp } from "@/server/lib/db-helpers";
import { EventType } from "@/types/events";

const EVENT_TYPE_VALUES = Object.values(EventType) as [string, ...string[]];

const timestampSchema = z.object({
    seconds: z.number(),
    nanoseconds: z.number(),
});

const geolocationSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
});

const workshopTypeSchema = z.enum(["Professional", "Academic", "None"]);

// Fields common to create/update; create requires name/eventType/startTime/endTime,
// update makes everything optional (handled via `.partial()` at the route level).
const eventBodySchema = z.object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    eventType: z.enum(EVENT_TYPE_VALUES),
    tags: z.array(z.string()).nullable().optional(),
    startTime: timestampSchema,
    endTime: timestampSchema,
    startTimeBuffer: z.number().nullable().optional(),
    endTimeBuffer: z.number().nullable().optional(),
    coverImageURI: z.string().nullable().optional(),
    signInPoints: z.number().nullable().optional(),
    signOutPoints: z.number().nullable().optional(),
    pointsPerHour: z.number().nullable().optional(),
    locationName: z.string().nullable().optional(),
    geolocation: geolocationSchema.nullable().optional(),
    geofencingRadius: z.number().nullable().optional(),
    committee: z.string().nullable().optional(),
    creator: z.string().nullable().optional(),
    general: z.boolean().nullable().optional(),
    hiddenEvent: z.boolean().nullable().optional(),
    notificationSent: z.boolean().nullable().optional(),
    nationalConventionEligible: z.boolean().nullable().optional(),
    workshopType: workshopTypeSchema.optional(),
});

const createEventSchema = eventBodySchema;
const updateEventSchema = eventBodySchema.partial();

const bulkApproveSchema = z.object({
    uids: z.array(z.string().min(1)).min(1),
});

/**
 * Converts a validated event body (post zod-parse) into Firestore-ready data:
 * `{seconds,nanoseconds}` -> Admin `Timestamp`, `{latitude,longitude}` -> Admin `GeoPoint`.
 * Only touches keys present on the input (safe for both create's full body and
 * update's partial body).
 */
function toFirestoreEventData(
    body: Partial<z.infer<typeof eventBodySchema>>
): Record<string, unknown> {
    const data: Record<string, unknown> = { ...body };

    if (body.startTime) {
        data.startTime = new Timestamp(body.startTime.seconds, body.startTime.nanoseconds);
    }
    if (body.endTime) {
        data.endTime = new Timestamp(body.endTime.seconds, body.endTime.nanoseconds);
    }
    if (body.geolocation) {
        data.geolocation = new GeoPoint(body.geolocation.latitude, body.geolocation.longitude);
    } else if (body.geolocation === null) {
        data.geolocation = null;
    }

    return data;
}

export const eventsRouter = new Hono();

eventsRouter.post("/", async (c) => {
    const parsed = createEventSchema.safeParse(await c.req.json().catch(() => null));
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

    const ref = adminDb.collection("events").doc();
    const data = toFirestoreEventData(parsed.data);
    await ref.set({ ...data, id: ref.id });

    return c.json({ id: ref.id }, 201);
});

eventsRouter.put("/:id", async (c) => {
    const id = c.req.param("id");
    const parsed = updateEventSchema.safeParse(await c.req.json().catch(() => null));
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

    const ref = adminDb.doc(`events/${id}`);
    const snap = await ref.get();
    if (!snap.exists) {
        return c.json(
            {
                error: {
                    code: "event_not_found",
                    message: `Event not found: events/${id}`,
                },
            },
            404
        );
    }

    const data = toFirestoreEventData(parsed.data);
    await ref.set(data, { merge: true });

    return c.json({ ok: true }, 200);
});

eventsRouter.post("/:id/logs/:uid/approve", async (c) => {
    const { id, uid } = c.req.param();

    const eventLogRef = adminDb.doc(`events/${id}/logs/${uid}`);
    const userEventLogRef = adminDb.doc(`users/${uid}/event-logs/${id}`);

    const eventLogSnap = await eventLogRef.get();
    if (!eventLogSnap.exists) {
        return c.json(
            {
                error: {
                    code: "log_not_found",
                    message: `Event log not found: events/${id}/logs/${uid}`,
                },
            },
            404
        );
    }

    const ops: BatchWriteOp[] = [
        { ref: eventLogRef, data: { verified: true }, merge: true },
        { ref: userEventLogRef, data: { verified: true }, merge: true },
    ];
    await chunkedAtomicBatch(ops);

    return c.json({ ok: true }, 200);
});

eventsRouter.post("/:id/logs/bulk-approve", async (c) => {
    const id = c.req.param("id");
    const parsed = bulkApproveSchema.safeParse(await c.req.json().catch(() => null));
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

    const { uids } = parsed.data;

    // Check all canonical logs exist first so the batch stays all-or-nothing:
    // no writes happen if any uid is missing.
    const eventLogRefs = uids.map((uid) => adminDb.doc(`events/${id}/logs/${uid}`));
    const eventLogSnaps = await Promise.all(eventLogRefs.map((ref) => ref.get()));

    const missingUids = uids.filter((_, i) => !eventLogSnaps[i].exists);
    if (missingUids.length > 0) {
        return c.json(
            {
                error: {
                    code: "log_not_found",
                    message: `Event log(s) not found for events/${id}: ${missingUids.join(", ")}`,
                    details: { missingUids },
                },
            },
            404
        );
    }

    const ops: BatchWriteOp[] = uids.flatMap((uid) => [
        { ref: adminDb.doc(`events/${id}/logs/${uid}`), data: { verified: true }, merge: true },
        { ref: adminDb.doc(`users/${uid}/event-logs/${id}`), data: { verified: true }, merge: true },
    ]);

    await chunkedAtomicBatch(ops);

    return c.json({ ok: true, approved: uids.length }, 200);
});
