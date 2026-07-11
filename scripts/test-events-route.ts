/**
 * Self-test for server/routes/events.ts (BUILD_PLAN E1 acceptance criteria).
 *
 * Run with the emulators up + seeded (`bun run seed`): `bun run scripts/test-events-route.ts`
 * Admin SDK, no credentials — points at the Emulator Suite only.
 *
 * The router is not registered on server/app.ts yet, so this mounts
 * `eventsRouter` directly on a throwaway Hono app (no auth middleware) and
 * drives it with `app.request(...)`.
 *
 * Verifies:
 *  1. POST / with {seconds,nanoseconds} timestamps -> doc has native
 *     Admin `Timestamp`s (round-tripped correctly).
 *  2. POST / with an invalid eventType -> 400.
 *  3. PUT /:id updates a field.
 *  4. POST /:id/logs/:uid/approve flips `verified` on both seeded log paths
 *     (event-workshop-01/member-02, seeded unverified).
 *  5. POST /:id/logs/bulk-approve on event-volunteer-01 uids
 *     [member-05, member-07] verifies BOTH on BOTH paths.
 *  6. bulk-approve with a missing uid -> 404 and no partial write.
 *
 * Cleans up any events it created.
 */

process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Hono } from "hono";

const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "tamushpemobileapp" });
const db = getFirestore(app);

import { eventsRouter } from "../server/routes/events";

const testApp = new Hono().route("/events", eventsRouter);

let failures = 0;
const createdEventIds: string[] = [];

function pass(label: string) {
    console.log(`PASS: ${label}`);
}

function fail(label: string, detail?: unknown) {
    failures += 1;
    console.log(`FAIL: ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}

async function req(method: string, path: string, body?: unknown) {
    const res = await testApp.request(path, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
}

async function testCreateEvent(): Promise<void> {
    const startTime = { seconds: 1_800_000_000, nanoseconds: 123_000_000 };
    const endTime = { seconds: 1_800_003_600, nanoseconds: 0 };

    const { status, json } = await req("POST", "/events", {
        name: "Test Route Event",
        eventType: "Workshop",
        startTime,
        endTime,
        workshopType: "Academic",
        geolocation: { latitude: 30.6, longitude: -96.3 },
    });

    if (status !== 201 || !json?.id) {
        fail("POST / -> 201 { id }", `status=${status} json=${JSON.stringify(json)}`);
        return;
    }
    createdEventIds.push(json.id);

    const snap = await db.doc(`events/${json.id}`).get();
    const data = snap.data();
    const startOk =
        data?.startTime instanceof Timestamp &&
        data.startTime.seconds === startTime.seconds &&
        data.startTime.nanoseconds === startTime.nanoseconds;
    const endOk = data?.endTime instanceof Timestamp && data.endTime.seconds === endTime.seconds;
    const idOk = data?.id === json.id;
    const geoOk =
        typeof data?.geolocation?.latitude === "number" && data.geolocation.latitude === 30.6;

    if (startOk && endOk && idOk && geoOk) {
        pass("POST / -> doc created with native Admin Timestamps + id field + GeoPoint");
    } else {
        fail(
            "POST / -> doc created with native Admin Timestamps",
            JSON.stringify({ startOk, endOk, idOk, geoOk, data })
        );
    }
}

async function testInvalidEventType(): Promise<void> {
    const { status } = await req("POST", "/events", {
        name: "Bad Event",
        eventType: "Not A Real Type",
        startTime: { seconds: 1, nanoseconds: 0 },
        endTime: { seconds: 2, nanoseconds: 0 },
    });

    if (status === 400) {
        pass("POST / with invalid eventType -> 400");
    } else {
        fail("POST / with invalid eventType -> 400", `got status=${status}`);
    }
}

async function testUpdateEvent(): Promise<void> {
    if (createdEventIds.length === 0) {
        fail("PUT /:id updates a field", "no created event to update");
        return;
    }
    const id = createdEventIds[0];

    const { status, json } = await req("PUT", `/events/${id}`, {
        name: "Updated Test Route Event",
    });

    if (status !== 200 || json?.ok !== true) {
        fail("PUT /:id -> 200 { ok: true }", `status=${status} json=${JSON.stringify(json)}`);
        return;
    }

    const snap = await db.doc(`events/${id}`).get();
    if (snap.get("name") === "Updated Test Route Event") {
        pass("PUT /:id -> field updated");
    } else {
        fail("PUT /:id -> field updated", `got name=${snap.get("name")}`);
    }

    const { status: notFoundStatus } = await req("PUT", "/events/this-event-does-not-exist", {
        name: "x",
    });
    if (notFoundStatus === 404) {
        pass("PUT /:id on missing event -> 404");
    } else {
        fail("PUT /:id on missing event -> 404", `got status=${notFoundStatus}`);
    }
}

async function testSingleApprove(): Promise<void> {
    const eventId = "event-workshop-01";
    const uid = "member-02";

    // Pre-condition: seeded unverified.
    const beforeEventLog = await db.doc(`events/${eventId}/logs/${uid}`).get();
    const beforeUserLog = await db.doc(`users/${uid}/event-logs/${eventId}`).get();
    if (beforeEventLog.get("verified") !== false || beforeUserLog.get("verified") !== false) {
        fail(
            "single approve precondition: seeded unverified",
            `eventLog.verified=${beforeEventLog.get("verified")} userLog.verified=${beforeUserLog.get("verified")}`
        );
        return;
    }

    const { status, json } = await req("POST", `/events/${eventId}/logs/${uid}/approve`);
    if (status !== 200 || json?.ok !== true) {
        fail("POST /:id/logs/:uid/approve -> 200 { ok: true }", `status=${status} json=${JSON.stringify(json)}`);
        return;
    }

    const afterEventLog = await db.doc(`events/${eventId}/logs/${uid}`).get();
    const afterUserLog = await db.doc(`users/${uid}/event-logs/${eventId}`).get();

    if (afterEventLog.get("verified") === true && afterUserLog.get("verified") === true) {
        pass("single approve -> verified:true on both event log + user event-log paths");
    } else {
        fail(
            "single approve -> verified:true on both paths",
            `eventLog.verified=${afterEventLog.get("verified")} userLog.verified=${afterUserLog.get("verified")}`
        );
    }
}

async function testBulkApprove(): Promise<void> {
    const eventId = "event-volunteer-01";
    const uids = ["member-05", "member-07"];

    // Pre-condition: seeded unverified.
    for (const uid of uids) {
        const eventLog = await db.doc(`events/${eventId}/logs/${uid}`).get();
        const userLog = await db.doc(`users/${uid}/event-logs/${eventId}`).get();
        if (eventLog.get("verified") !== false || userLog.get("verified") !== false) {
            fail(
                `bulk approve precondition: ${uid} seeded unverified`,
                `eventLog.verified=${eventLog.get("verified")} userLog.verified=${userLog.get("verified")}`
            );
            return;
        }
    }

    const { status, json } = await req("POST", `/events/${eventId}/logs/bulk-approve`, { uids });
    if (status !== 200 || json?.ok !== true || json?.approved !== uids.length) {
        fail(
            "POST /:id/logs/bulk-approve -> 200 { ok: true, approved: n }",
            `status=${status} json=${JSON.stringify(json)}`
        );
        return;
    }

    let allVerified = true;
    for (const uid of uids) {
        const eventLog = await db.doc(`events/${eventId}/logs/${uid}`).get();
        const userLog = await db.doc(`users/${uid}/event-logs/${eventId}`).get();
        if (eventLog.get("verified") !== true || userLog.get("verified") !== true) {
            allVerified = false;
        }
    }

    if (allVerified) {
        pass("bulk approve -> verified:true on both paths for all uids");
    } else {
        fail("bulk approve -> verified:true on both paths for all uids");
    }
}

async function testBulkApproveMissingUid(): Promise<void> {
    const eventId = "event-general-01";
    const uids = ["member-01", "this-uid-does-not-exist"];

    // Snapshot the good uid's state before, to confirm no partial write happens.
    const before = await db.doc(`events/${eventId}/logs/member-01`).get();
    const beforeVerified = before.get("verified");

    const { status, json } = await req("POST", `/events/${eventId}/logs/bulk-approve`, { uids });

    if (status !== 404) {
        fail("bulk approve with missing uid -> 404", `got status=${status} json=${JSON.stringify(json)}`);
        return;
    }

    const after = await db.doc(`events/${eventId}/logs/member-01`).get();
    const afterVerified = after.get("verified");

    if (afterVerified === beforeVerified) {
        pass("bulk approve with missing uid -> 404, no partial write to the valid uid's logs");
    } else {
        fail(
            "bulk approve with missing uid -> no partial write",
            `before=${beforeVerified} after=${afterVerified}`
        );
    }
}

async function cleanup(): Promise<void> {
    for (const id of createdEventIds) {
        await db.doc(`events/${id}`).delete();
    }
}

async function main() {
    console.log("Running E1 events-route self-tests against the emulator...\n");

    try {
        await testCreateEvent();
        await testInvalidEventType();
        await testUpdateEvent();
        await testSingleApprove();
        await testBulkApprove();
        await testBulkApproveMissingUid();
    } finally {
        await cleanup();
    }

    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    if (failures > 0) process.exit(1);
}

main().catch((err) => {
    console.error("Unhandled error in test run:", err);
    process.exit(1);
});
