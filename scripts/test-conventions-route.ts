/**
 * Self-test for server/routes/conventions.ts (BUILD_PLAN acceptance criteria).
 *
 * Run with the emulators up: `bun run scripts/test-conventions-route.ts`
 * Router is NOT yet registered in server/app.ts (orchestrator does that), so
 * this mounts `conventionsRouter` on a scratch Hono app directly. Because the
 * router reads `c.get("user")` (normally set by the auth middleware in
 * production), a stub middleware is mounted ahead of it that does
 * `c.set("user", { uid: "test-officer" } as any)`.
 *
 * Self-contained: creates its own `users/{uid}` fixtures under test-prefixed
 * uids and cleans up (users + convention-tracking docs) in a finally block.
 *
 * Verifies:
 *  1. POST /track with 2 valid, untracked uids -> 200, `tracked` contains
 *     both, and `convention-tracking/{uid}` docs exist with a `dateAdded`
 *     Timestamp and `addedBy: "test-officer"`.
 *  2. Re-POST the same uids -> 200, both land in `alreadyTracked`, `tracked`
 *     is empty, and `dateAdded` is unchanged (read before/after, compare).
 *  3. POST with 1 new valid uid + 1 unknown uid -> `tracked` has the valid
 *     one, `unknownUids` has the unknown one, no doc created for the unknown
 *     uid.
 *  4. Bad bodies (`{}`, `{ uids: [] }`, `{ uids: [""] }`, non-JSON) -> all 400
 *     with `error.code === "validation_error"`.
 *  5. POST /:uid/untrack for a tracked uid -> 200 `{ ok: true }`, doc gone;
 *     repeating the same call is still 200 (idempotent).
 */

process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";

import { Hono } from "hono";
import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { conventionsRouter } from "../server/routes/conventions";
import { adminDb } from "../server/firebaseAdmin";

let failures = 0;

function pass(label: string) {
    console.log(`PASS: ${label}`);
}

function fail(label: string, detail?: unknown) {
    failures += 1;
    console.log(`FAIL: ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}

const app = new Hono<{ Variables: { user: DecodedIdToken } }>();
app.use("*", async (c, next) => {
    c.set("user", { uid: "test-officer" } as unknown as DecodedIdToken);
    await next();
});
app.route("/conventions", conventionsRouter);

// Test-prefixed fixture uids — safe to create/delete without touching seeded data.
const UID_A = "test-convention-a";
const UID_B = "test-convention-b";
const UID_C = "test-convention-c";
const UNKNOWN_UID = "test-convention-does-not-exist";

const FIXTURE_UIDS = [UID_A, UID_B, UID_C];

async function seedFixtureUsers(): Promise<void> {
    await Promise.all(
        FIXTURE_UIDS.map((uid) =>
            adminDb.doc(`users/${uid}`).set({ uid, displayName: `Test Convention ${uid}` })
        )
    );
}

async function cleanupFixtures(): Promise<void> {
    const allUids = [...FIXTURE_UIDS, UNKNOWN_UID];
    await Promise.all([
        ...allUids.map((uid) => adminDb.doc(`users/${uid}`).delete()),
        ...allUids.map((uid) => adminDb.doc(`convention-tracking/${uid}`).delete()),
    ]);
}

async function testTrackNewUids(): Promise<void> {
    const res = await app.request("/conventions/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids: [UID_A, UID_B] }),
    });

    if (res.status !== 200) {
        fail("track 2 new valid uids -> 200", `got status ${res.status}`);
        return;
    }
    const body = await res.json();
    const tracked: string[] = body.tracked ?? [];
    if (tracked.includes(UID_A) && tracked.includes(UID_B) && tracked.length === 2) {
        pass("track 2 new valid uids -> both in `tracked`");
    } else {
        fail("track 2 new valid uids -> both in `tracked`", `got body ${JSON.stringify(body)}`);
    }

    const [snapA, snapB] = await Promise.all([
        adminDb.doc(`convention-tracking/${UID_A}`).get(),
        adminDb.doc(`convention-tracking/${UID_B}`).get(),
    ]);

    if (!snapA.exists || !snapB.exists) {
        fail("track 2 new valid uids -> docs exist in convention-tracking/", `A.exists=${snapA.exists}, B.exists=${snapB.exists}`);
        return;
    }

    const bothHaveFields = [snapA, snapB].every(
        (s) => s.get("dateAdded") instanceof Timestamp && s.get("addedBy") === "test-officer"
    );
    if (bothHaveFields) {
        pass("track 2 new valid uids -> docs have dateAdded (Timestamp) + addedBy: 'test-officer'");
    } else {
        fail(
            "track 2 new valid uids -> docs have dateAdded (Timestamp) + addedBy: 'test-officer'",
            `A=${JSON.stringify(snapA.data())}, B=${JSON.stringify(snapB.data())}`
        );
    }
}

async function testRetrackAlreadyTracked(): Promise<void> {
    const [beforeA, beforeB] = await Promise.all([
        adminDb.doc(`convention-tracking/${UID_A}`).get(),
        adminDb.doc(`convention-tracking/${UID_B}`).get(),
    ]);
    const beforeDateA = beforeA.get("dateAdded") as Timestamp;
    const beforeDateB = beforeB.get("dateAdded") as Timestamp;

    const res = await app.request("/conventions/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids: [UID_A, UID_B] }),
    });

    if (res.status !== 200) {
        fail("re-track same uids -> 200", `got status ${res.status}`);
        return;
    }
    const body = await res.json();
    const alreadyTracked: string[] = body.alreadyTracked ?? [];
    const tracked: string[] = body.tracked ?? [];

    if (
        alreadyTracked.includes(UID_A) &&
        alreadyTracked.includes(UID_B) &&
        alreadyTracked.length === 2 &&
        tracked.length === 0
    ) {
        pass("re-track same uids -> both in `alreadyTracked`, `tracked` empty");
    } else {
        fail("re-track same uids -> both in `alreadyTracked`, `tracked` empty", `got body ${JSON.stringify(body)}`);
    }

    const [afterA, afterB] = await Promise.all([
        adminDb.doc(`convention-tracking/${UID_A}`).get(),
        adminDb.doc(`convention-tracking/${UID_B}`).get(),
    ]);
    const afterDateA = afterA.get("dateAdded") as Timestamp;
    const afterDateB = afterB.get("dateAdded") as Timestamp;

    if (beforeDateA.isEqual(afterDateA) && beforeDateB.isEqual(afterDateB)) {
        pass("re-track same uids -> original dateAdded values unchanged");
    } else {
        fail(
            "re-track same uids -> original dateAdded values unchanged",
            `before=(${beforeDateA.toDate().toISOString()}, ${beforeDateB.toDate().toISOString()}), after=(${afterDateA.toDate().toISOString()}, ${afterDateB.toDate().toISOString()})`
        );
    }
}

async function testMixedValidAndUnknown(): Promise<void> {
    const res = await app.request("/conventions/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uids: [UID_C, UNKNOWN_UID] }),
    });

    if (res.status !== 200) {
        fail("track mix of valid + unknown uid -> 200", `got status ${res.status}`);
        return;
    }
    const body = await res.json();
    const tracked: string[] = body.tracked ?? [];
    const unknownUids: string[] = body.unknownUids ?? [];

    if (tracked.includes(UID_C) && tracked.length === 1 && unknownUids.includes(UNKNOWN_UID) && unknownUids.length === 1) {
        pass("track mix of valid + unknown uid -> valid in `tracked`, unknown in `unknownUids`");
    } else {
        fail(
            "track mix of valid + unknown uid -> valid in `tracked`, unknown in `unknownUids`",
            `got body ${JSON.stringify(body)}`
        );
    }

    const unknownSnap = await adminDb.doc(`convention-tracking/${UNKNOWN_UID}`).get();
    if (!unknownSnap.exists) {
        pass("track mix of valid + unknown uid -> no convention-tracking doc created for unknown uid");
    } else {
        fail("track mix of valid + unknown uid -> no convention-tracking doc created for unknown uid", "doc exists");
    }
}

async function expectValidationError(label: string, body: BodyInit | null, contentType = "application/json"): Promise<void> {
    const res = await app.request("/conventions/track", {
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
    await expectValidationError("track bad body {} -> 400 validation_error", JSON.stringify({}));
    await expectValidationError("track bad body { uids: [] } -> 400 validation_error", JSON.stringify({ uids: [] }));
    await expectValidationError("track bad body { uids: [''] } -> 400 validation_error", JSON.stringify({ uids: [""] }));
    await expectValidationError("track non-JSON body -> 400 validation_error", "not json at all", "text/plain");
}

async function testUntrack(): Promise<void> {
    // UID_C was tracked by testMixedValidAndUnknown above.
    const preSnap = await adminDb.doc(`convention-tracking/${UID_C}`).get();
    if (!preSnap.exists) {
        fail("untrack precondition — convention-tracking/test-convention-c exists", "doc not found");
        return;
    }

    const res = await app.request(`/conventions/${UID_C}/untrack`, { method: "POST" });
    if (res.status !== 200) {
        fail("untrack tracked uid -> 200 { ok: true }", `got status ${res.status}`);
        return;
    }
    const body = await res.json();
    if (!body.ok) {
        fail("untrack tracked uid -> 200 { ok: true }", `got body ${JSON.stringify(body)}`);
        return;
    }
    pass("untrack tracked uid -> 200 { ok: true }");

    const postSnap = await adminDb.doc(`convention-tracking/${UID_C}`).get();
    if (!postSnap.exists) {
        pass("untrack tracked uid -> convention-tracking doc gone");
    } else {
        fail("untrack tracked uid -> convention-tracking doc gone", "doc still exists");
    }

    // Repeat: should still be 200 (idempotent), even though the doc is already gone.
    const res2 = await app.request(`/conventions/${UID_C}/untrack`, { method: "POST" });
    if (res2.status !== 200) {
        fail("repeat untrack on already-untracked uid -> still 200", `got status ${res2.status}`);
        return;
    }
    const body2 = await res2.json();
    if (body2.ok) {
        pass("repeat untrack on already-untracked uid -> still 200 { ok: true }");
    } else {
        fail("repeat untrack on already-untracked uid -> still 200 { ok: true }", `got body ${JSON.stringify(body2)}`);
    }
}

async function main() {
    console.log("Running conventions-route self-tests against the emulator...\n");

    try {
        await seedFixtureUsers();

        await testTrackNewUids();
        await testRetrackAlreadyTracked();
        await testMixedValidAndUnknown();
        await testBadBodies();
        await testUntrack();
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
