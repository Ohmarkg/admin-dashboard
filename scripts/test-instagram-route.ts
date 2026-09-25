/**
 * Self-test for server/routes/instagram.ts.
 *
 * Run with the emulators up: `bun run scripts/test-instagram-route.ts`
 * Mounts `instagramRouter` on a scratch Hono app directly (the router does
 * not read `c.get("user")`, so no auth stub is needed).
 *
 * Self-contained: creates its own `users/{uid}` fixtures under test-prefixed
 * uids and cleans up (users, event logs, user event-log mirrors, and the
 * hidden event itself when this run created it) in a finally block.
 *
 * Verifies:
 *  1. First award with no "Instagram Points" event -> 200, event lazily
 *     created with the mobile app's exact field set (hiddenEvent: true,
 *     signInPoints: 1, eventType "Custom Event", ...), and BOTH
 *     `events/{id}/logs/{uid}` and `users/{uid}/event-logs/{id}` exist with
 *     `points: 1`, `verified: true`, `instagramLogs` length 1.
 *  2. Re-award the same uid -> points: 2, instagramLogs length 2, original
 *     `creationTime` unchanged, and still exactly one "Instagram Points"
 *     event (no duplicate creation).
 *  3. Mixed valid + unknown uid -> valid in `awarded`, unknown in
 *     `unknownUids`, no docs created for the unknown uid.
 *  4. Callable-compat: a pre-existing log doc shaped like the mobile
 *     `addInstagramPoints` callable writes (extra fields present) is
 *     read-modify-merged — points incremented, timestamp appended, foreign
 *     fields preserved on both copies.
 *  5. Bad bodies (`{}`, `{ uids: [] }`, `{ uids: [""] }`, 201 uids, non-JSON)
 *     -> all 400 with `error.code === "validation_error"` (both routes).
 *  6. Revoke pops ONE award: points and `instagramLogs` drop by exactly one on
 *     BOTH copies, and the remaining timestamps are the earlier ones.
 *  7. Revoking the LAST award off a bare award log DELETES both docs (so the
 *     member leaves the tools table), while a log carrying a real `signInTime`
 *     is emptied to `points: 0` / `instagramLogs: []` and kept.
 *  8. Revoking a uid with no log, or with an already-empty history, reports it
 *     in `notAwarded` and writes nothing.
 *  9. Revoke with no "Instagram Points" event at all -> 404
 *     `instagram_event_not_found` (a removal must never create the event).
 */

import "./lib/requireEmulator";
import { Hono } from "hono";
import { Timestamp } from "firebase-admin/firestore";
import { instagramRouter } from "../server/routes/instagram";
import { adminDb } from "../server/firebaseAdmin";

let failures = 0;

function pass(label: string) {
    console.log(`PASS: ${label}`);
}

function fail(label: string, detail?: unknown) {
    failures += 1;
    console.log(`FAIL: ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}

const app = new Hono();
app.route("/instagram", instagramRouter);

const INSTAGRAM_EVENT_NAME = "Instagram Points";

// Test-prefixed fixture uids — safe to create/delete without touching seeded data.
const UID_A = "test-instagram-a";
const UID_B = "test-instagram-b";
const UID_CALLABLE = "test-instagram-callable";
const UNKNOWN_UID = "test-instagram-does-not-exist";

const FIXTURE_UIDS = [UID_A, UID_B, UID_CALLABLE];

/** Event ids that existed before the run — never deleted by cleanup. */
let preexistingEventIds: Set<string> = new Set();

async function findInstagramEventIds(): Promise<string[]> {
    const snap = await adminDb
        .collection("events")
        .where("name", "==", INSTAGRAM_EVENT_NAME)
        .get();
    return snap.docs.map((d) => d.id);
}

async function seedFixtureUsers(): Promise<void> {
    preexistingEventIds = new Set(await findInstagramEventIds());
    await Promise.all(
        FIXTURE_UIDS.map((uid) =>
            adminDb.doc(`users/${uid}`).set({ uid, displayName: `Test Instagram ${uid}` })
        )
    );
}

async function cleanupFixtures(): Promise<void> {
    const eventIds = await findInstagramEventIds();
    const allUids = [...FIXTURE_UIDS, UNKNOWN_UID];
    await Promise.all([
        ...allUids.map((uid) => adminDb.doc(`users/${uid}`).delete()),
        ...eventIds.flatMap((eventId) => [
            ...allUids.map((uid) => adminDb.doc(`events/${eventId}/logs/${uid}`).delete()),
            ...allUids.map((uid) => adminDb.doc(`users/${uid}/event-logs/${eventId}`).delete()),
        ]),
    ]);
    // Only remove events this run created; a seeded/preexisting event is left alone.
    await Promise.all(
        eventIds
            .filter((id) => !preexistingEventIds.has(id))
            .map((id) => adminDb.doc(`events/${id}`).delete())
    );
}

async function postAward(uids: string[]): Promise<Response> {
    return app.request("/instagram/award", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids }),
    });
}

async function postRevoke(uids: string[]): Promise<Response> {
    return app.request("/instagram/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids }),
    });
}

async function testFirstAwardCreatesEvent(): Promise<string | null> {
    const res = await postAward([UID_A]);
    if (res.status !== 200) {
        fail("first award -> 200", `got status ${res.status}`);
        return null;
    }
    const body = await res.json();
    if (body.ok && body.awarded?.length === 1 && body.awarded[0] === UID_A && body.pointsPerAward === 1) {
        pass("first award -> ok, awarded=[uid], pointsPerAward=1");
    } else {
        fail("first award -> ok, awarded=[uid], pointsPerAward=1", `got body ${JSON.stringify(body)}`);
    }

    const eventId: string = body.eventId;
    const eventSnap = await adminDb.doc(`events/${eventId}`).get();
    if (!eventSnap.exists) {
        fail("first award -> event doc exists", `events/${eventId} missing`);
        return eventId;
    }
    const e = eventSnap.data()!;
    const fieldChecks =
        e.name === INSTAGRAM_EVENT_NAME &&
        e.eventType === "Custom Event" &&
        e.general === false &&
        e.hiddenEvent === true &&
        e.locationName === "Instagram" &&
        e.notificationSent === true &&
        e.pointsPerHour === 0 &&
        e.signInPoints === 1 &&
        e.signOutPoints === 0 &&
        e.startTime instanceof Timestamp &&
        e.endTime instanceof Timestamp;
    if (fieldChecks) {
        pass("first award -> event created with the mobile app's exact field set");
    } else {
        fail("first award -> event created with the mobile app's exact field set", JSON.stringify(e));
    }

    const [logSnap, mirrorSnap] = await Promise.all([
        adminDb.doc(`events/${eventId}/logs/${UID_A}`).get(),
        adminDb.doc(`users/${UID_A}/event-logs/${eventId}`).get(),
    ]);
    for (const [label, snap] of [
        ["events/{id}/logs/{uid}", logSnap],
        ["users/{uid}/event-logs/{id}", mirrorSnap],
    ] as const) {
        if (!snap.exists) {
            fail(`first award -> ${label} exists`, "doc missing");
            continue;
        }
        const log = snap.data()!;
        const ok =
            log.points === 1 &&
            log.verified === true &&
            log.uid === UID_A &&
            log.eventId === eventId &&
            Array.isArray(log.instagramLogs) &&
            log.instagramLogs.length === 1 &&
            log.instagramLogs[0] instanceof Timestamp &&
            log.creationTime instanceof Timestamp;
        if (ok) {
            pass(`first award -> ${label} has points 1, verified, 1 instagramLog`);
        } else {
            fail(`first award -> ${label} has points 1, verified, 1 instagramLog`, JSON.stringify(log));
        }
    }
    return eventId;
}

async function testReAwardAccumulates(eventId: string): Promise<void> {
    const before = await adminDb.doc(`events/${eventId}/logs/${UID_A}`).get();
    const beforeCreation = before.get("creationTime") as Timestamp;

    const res = await postAward([UID_A]);
    if (res.status !== 200) {
        fail("re-award same uid -> 200", `got status ${res.status}`);
        return;
    }
    const body = await res.json();
    if (body.eventId === eventId) {
        pass("re-award -> reuses the existing event (same eventId)");
    } else {
        fail("re-award -> reuses the existing event (same eventId)", `got ${body.eventId}, expected ${eventId}`);
    }

    const eventIds = await findInstagramEventIds();
    if (eventIds.length === Math.max(1, preexistingEventIds.size + (preexistingEventIds.has(eventId) ? 0 : 1))) {
        pass("re-award -> no duplicate 'Instagram Points' event created");
    } else {
        fail("re-award -> no duplicate 'Instagram Points' event created", `found ${eventIds.length} events`);
    }

    const after = await adminDb.doc(`events/${eventId}/logs/${UID_A}`).get();
    const log = after.data()!;
    if (log.points === 2 && log.instagramLogs?.length === 2) {
        pass("re-award -> points 2, instagramLogs length 2");
    } else {
        fail("re-award -> points 2, instagramLogs length 2", JSON.stringify(log));
    }
    if (beforeCreation.isEqual(log.creationTime as Timestamp)) {
        pass("re-award -> original creationTime unchanged");
    } else {
        fail("re-award -> original creationTime unchanged");
    }

    const mirror = await adminDb.doc(`users/${UID_A}/event-logs/${eventId}`).get();
    const mirrorLog = mirror.data()!;
    if (mirrorLog.points === 2 && mirrorLog.instagramLogs?.length === 2) {
        pass("re-award -> user mirror also at points 2, 2 instagramLogs");
    } else {
        fail("re-award -> user mirror also at points 2, 2 instagramLogs", JSON.stringify(mirrorLog));
    }
}

async function testMixedValidAndUnknown(eventId: string): Promise<void> {
    const res = await postAward([UID_B, UNKNOWN_UID]);
    if (res.status !== 200) {
        fail("award mix of valid + unknown uid -> 200", `got status ${res.status}`);
        return;
    }
    const body = await res.json();
    const awarded: string[] = body.awarded ?? [];
    const unknownUids: string[] = body.unknownUids ?? [];
    if (awarded.length === 1 && awarded[0] === UID_B && unknownUids.length === 1 && unknownUids[0] === UNKNOWN_UID) {
        pass("award mix -> valid in `awarded`, unknown in `unknownUids`");
    } else {
        fail("award mix -> valid in `awarded`, unknown in `unknownUids`", JSON.stringify(body));
    }

    const [unknownLog, unknownMirror] = await Promise.all([
        adminDb.doc(`events/${eventId}/logs/${UNKNOWN_UID}`).get(),
        adminDb.doc(`users/${UNKNOWN_UID}/event-logs/${eventId}`).get(),
    ]);
    if (!unknownLog.exists && !unknownMirror.exists) {
        pass("award mix -> no log docs created for unknown uid");
    } else {
        fail("award mix -> no log docs created for unknown uid");
    }
}

async function testCallableShapedLogCompat(eventId: string): Promise<void> {
    // Simulate a log previously written by the mobile `addInstagramPoints`
    // callable, including a foreign field the web route doesn't know about.
    const callableTime = Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const callableLog = {
        uid: UID_CALLABLE,
        eventId,
        creationTime: callableTime,
        verified: true,
        points: 1,
        instagramLogs: [callableTime],
        signInTime: callableTime, // foreign field: must survive the merge
    };
    await Promise.all([
        adminDb.doc(`events/${eventId}/logs/${UID_CALLABLE}`).set(callableLog),
        adminDb.doc(`users/${UID_CALLABLE}/event-logs/${eventId}`).set(callableLog),
    ]);

    const res = await postAward([UID_CALLABLE]);
    if (res.status !== 200) {
        fail("callable-compat award -> 200", `got status ${res.status}`);
        return;
    }
    const after = await adminDb.doc(`events/${eventId}/logs/${UID_CALLABLE}`).get();
    const log = after.data()!;
    const ok =
        log.points === 2 &&
        log.instagramLogs?.length === 2 &&
        (log.instagramLogs[0] as Timestamp).isEqual(callableTime) &&
        (log.creationTime as Timestamp).isEqual(callableTime) &&
        (log.signInTime as Timestamp)?.isEqual(callableTime);
    if (ok) {
        pass("callable-compat -> points incremented, timestamp appended, foreign fields preserved");
    } else {
        fail("callable-compat -> points incremented, timestamp appended, foreign fields preserved", JSON.stringify(log));
    }
}

/**
 * Revoke pops the most recent award: both copies drop to `points - 1` and one
 * fewer `instagramLogs` entry, and the entries that remain are the EARLIER
 * ones (a pop, not a shift).
 */
async function testRevokePopsOneAward(eventId: string): Promise<void> {
    const before = await adminDb.doc(`events/${eventId}/logs/${UID_A}`).get();
    const beforeLogs = before.get("instagramLogs") as Timestamp[];

    const res = await postRevoke([UID_A]);
    if (res.status !== 200) {
        fail("revoke -> 200", `got status ${res.status}`);
        return;
    }
    const body = await res.json();
    if (body.ok && body.revoked?.length === 1 && body.revoked[0] === UID_A && body.notAwarded?.length === 0) {
        pass("revoke -> ok, revoked=[uid], notAwarded=[]");
    } else {
        fail("revoke -> ok, revoked=[uid], notAwarded=[]", JSON.stringify(body));
    }

    for (const [label, path] of [
        ["events/{id}/logs/{uid}", `events/${eventId}/logs/${UID_A}`],
        ["users/{uid}/event-logs/{id}", `users/${UID_A}/event-logs/${eventId}`],
    ] as const) {
        const snap = await adminDb.doc(path).get();
        const log = snap.data();
        const logs = (log?.instagramLogs ?? []) as Timestamp[];
        const ok =
            snap.exists &&
            log!.points === 1 &&
            logs.length === 1 &&
            logs[0].isEqual(beforeLogs[0]); // the EARLIER timestamp survived
        if (ok) {
            pass(`revoke -> ${label} at points 1, 1 instagramLog, earliest kept`);
        } else {
            fail(`revoke -> ${label} at points 1, 1 instagramLog, earliest kept`, JSON.stringify(log));
        }
    }
}

/** Removing the final award off a bare award log deletes both copies. */
async function testRevokeLastAwardDeletesBareLog(eventId: string): Promise<void> {
    const res = await postRevoke([UID_A]);
    if (res.status !== 200) {
        fail("revoke last award -> 200", `got status ${res.status}`);
        return;
    }

    const [logSnap, mirrorSnap] = await Promise.all([
        adminDb.doc(`events/${eventId}/logs/${UID_A}`).get(),
        adminDb.doc(`users/${UID_A}/event-logs/${eventId}`).get(),
    ]);
    if (!logSnap.exists && !mirrorSnap.exists) {
        pass("revoke last award -> both bare log docs deleted");
    } else {
        fail(
            "revoke last award -> both bare log docs deleted",
            `log exists: ${logSnap.exists}, mirror exists: ${mirrorSnap.exists}`
        );
    }

    // ...and a further revoke has nothing left to take.
    const againRes = await postRevoke([UID_A]);
    const againBody = await againRes.json();
    if (againRes.status === 200 && againBody.revoked?.length === 0 && againBody.notAwarded?.[0] === UID_A) {
        pass("revoke with no log left -> reported in notAwarded, nothing written");
    } else {
        fail("revoke with no log left -> reported in notAwarded, nothing written", JSON.stringify(againBody));
    }
}

/**
 * The delete is guarded: a log carrying a real `signInTime` (mobile
 * attendance) is emptied rather than deleted, so attendance data is never
 * collateral damage of a points removal.
 */
async function testRevokeKeepsLogWithAttendanceTimes(eventId: string): Promise<void> {
    // UID_CALLABLE has 2 awards and a signInTime — take both away.
    await postRevoke([UID_CALLABLE]);
    const res = await postRevoke([UID_CALLABLE]);
    if (res.status !== 200) {
        fail("revoke attendance-bearing log -> 200", `got status ${res.status}`);
        return;
    }

    const snap = await adminDb.doc(`events/${eventId}/logs/${UID_CALLABLE}`).get();
    const log = snap.data();
    const ok =
        snap.exists &&
        log!.points === 0 &&
        Array.isArray(log!.instagramLogs) &&
        log!.instagramLogs.length === 0 &&
        log!.signInTime instanceof Timestamp;
    if (ok) {
        pass("revoke all awards on an attendance-bearing log -> kept, emptied, signInTime preserved");
    } else {
        fail("revoke all awards on an attendance-bearing log -> kept, emptied, signInTime preserved", JSON.stringify(log));
    }
}

/** A revoke must never lazily create the event the way an award does. */
async function testRevokeWithNoEvent(): Promise<void> {
    const res = await postRevoke([UID_A]);
    const body = await res.json();
    if (res.status === 404 && body?.error?.code === "instagram_event_not_found") {
        pass("revoke with no Instagram Points event -> 404 instagram_event_not_found");
    } else {
        fail("revoke with no Instagram Points event -> 404 instagram_event_not_found", `status ${res.status}, body ${JSON.stringify(body)}`);
    }

    if ((await findInstagramEventIds()).length === 0) {
        pass("revoke with no event -> did NOT create the event");
    } else {
        fail("revoke with no event -> did NOT create the event");
    }
}

async function expectValidationError(
    label: string,
    body: BodyInit | null,
    contentType = "application/json",
    path = "/instagram/award"
): Promise<void> {
    const res = await app.request(path, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
    });
    if (res.status !== 400) {
        fail(label, `expected 400, got ${res.status}`);
        return;
    }
    const responseBody = await res.json();
    if (responseBody?.error?.code === "validation_error") {
        pass(label);
    } else {
        fail(label, `got body ${JSON.stringify(responseBody)}`);
    }
}

async function testBadBodies(): Promise<void> {
    await expectValidationError("award bad body {} -> 400 validation_error", JSON.stringify({}));
    await expectValidationError("award bad body { uids: [] } -> 400 validation_error", JSON.stringify({ uids: [] }));
    await expectValidationError("award bad body { uids: [''] } -> 400 validation_error", JSON.stringify({ uids: [""] }));
    await expectValidationError(
        "award bad body with 201 uids -> 400 validation_error",
        JSON.stringify({ uids: Array.from({ length: 201 }, (_, i) => `u${i}`) })
    );
    await expectValidationError("award non-JSON body -> 400 validation_error", "not json at all", "text/plain");

    await expectValidationError(
        "revoke bad body {} -> 400 validation_error",
        JSON.stringify({}),
        "application/json",
        "/instagram/revoke"
    );
    await expectValidationError(
        "revoke bad body { uids: [] } -> 400 validation_error",
        JSON.stringify({ uids: [] }),
        "application/json",
        "/instagram/revoke"
    );
    await expectValidationError(
        "revoke non-JSON body -> 400 validation_error",
        "not json at all",
        "text/plain",
        "/instagram/revoke"
    );
}

async function main() {
    console.log("Running instagram-route self-tests against the emulator...\n");

    try {
        await seedFixtureUsers();

        // Only meaningful on a clean emulator — skipped when a seeded or
        // leftover "Instagram Points" event already exists.
        if (preexistingEventIds.size === 0) {
            await testRevokeWithNoEvent();
        }

        const eventId = await testFirstAwardCreatesEvent();
        if (eventId) {
            await testReAwardAccumulates(eventId);
            await testMixedValidAndUnknown(eventId);
            await testCallableShapedLogCompat(eventId);
            // Revoke runs last: it consumes the awards the tests above built up.
            await testRevokePopsOneAward(eventId);
            await testRevokeLastAwardDeletesBareLog(eventId);
            await testRevokeKeepsLogWithAttendanceTimes(eventId);
        }
        await testBadBodies();
    } finally {
        await cleanupFixtures();
    }

    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    if (failures > 0) process.exit(1);
}

main().catch((err) => {
    console.error("Unhandled error in test run:", err);
    process.exit(1);
});
