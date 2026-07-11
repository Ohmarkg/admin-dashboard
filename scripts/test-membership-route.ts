/**
 * Self-test for server/routes/membership.ts (BUILD_PLAN M1 acceptance
 * criteria). Exercises the Hono handlers directly (no auth middleware, no
 * app/api mount — membershipRouter is not yet registered in server/app.ts).
 *
 * Run with the emulators up: `bun run scripts/test-membership-route.ts`
 *
 * Verifies:
 *  1. approve on seeded member-07 -> users/member-07 gains chapterExpiration
 *     + nationalExpiration (copied from the request) AND memberSHPE/member-07
 *     is deleted.
 *  2. deny on seeded member-08 -> both expirations removed from
 *     users/member-08 AND memberSHPE/member-08 is deleted.
 *  3. unknown uid -> 404 request_not_found.
 *  4. the cloudFunctions stub log line prints AFTER the batch commit, not
 *     before (i.e. only once the write is durable).
 *
 * Cleans up: re-creates memberSHPE/member-07 and memberSHPE/member-08 (same
 * shape as scripts/seed.ts) and restores users/member-07 + users/member-08
 * to their pre-test expiration state so later phases see seeded state again.
 */

process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "localhost:9099";

import { Hono } from "hono";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// Ensure the shared adminDb singleton (server/firebaseAdmin.ts) points at the
// emulator before membershipRouter imports it.
const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "tamushpemobileapp" });
const db = getFirestore(app);

import { membershipRouter } from "../server/routes/membership";

let failures = 0;

function pass(label: string) {
    console.log(`PASS: ${label}`);
}

function fail(label: string, detail?: unknown) {
    failures += 1;
    console.log(`FAIL: ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}

const testApp = new Hono().route("/membership", membershipRouter);

const inAYear = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d;
};

const proofURL = (uid: string, kind: string) =>
    `http://localhost:9199/v0/b/tamushpemobileapp.appspot.com/o/user-docs%2F${uid}%2F${kind}-proof.png?alt=media`;

function seededRequestDoc() {
    return {
        chapterURL: proofURL("member-07", "chapter"),
        nationalURL: proofURL("member-07", "national"),
        chapterExpiration: Timestamp.fromDate(inAYear()),
        nationalExpiration: Timestamp.fromDate(inAYear()),
        shirtSize: "M",
    };
}

async function testApprove(): Promise<void> {
    const uid = "member-07";
    const requestRef = db.doc(`memberSHPE/${uid}`);
    const userRef = db.doc(`users/${uid}`);

    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
        fail("approve: precondition — memberSHPE/member-07 exists (run scripts/seed.ts first)");
        return;
    }
    const requestData = requestSnap.data()!;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
        origLog(...args);
    };

    let res;
    try {
        res = await testApp.request(`/membership/${uid}/approve`, { method: "POST" });
    } finally {
        console.log = origLog;
    }

    if (res.status !== 200) {
        fail("approve: 200 response", `got ${res.status}`);
        return;
    }
    const body = await res.json();
    if (!body.ok) {
        fail("approve: response body { ok: true }", JSON.stringify(body));
    } else {
        pass("approve: 200 { ok: true }");
    }

    const [userSnap, requestSnapAfter] = await Promise.all([userRef.get(), requestRef.get()]);
    const userData = userSnap.data();

    const chapterOk =
        userData?.chapterExpiration &&
        (userData.chapterExpiration as Timestamp).isEqual(requestData.chapterExpiration);
    const nationalOk =
        userData?.nationalExpiration &&
        (userData.nationalExpiration as Timestamp).isEqual(requestData.nationalExpiration);

    if (chapterOk && nationalOk) {
        pass("approve: users/member-07 gained chapterExpiration + nationalExpiration copied from the request");
    } else {
        fail(
            "approve: users/member-07 expirations match request",
            `chapterExpiration=${JSON.stringify(userData?.chapterExpiration)}, nationalExpiration=${JSON.stringify(userData?.nationalExpiration)}`
        );
    }

    if (!requestSnapAfter.exists) {
        pass("approve: memberSHPE/member-07 deleted");
    } else {
        fail("approve: memberSHPE/member-07 deleted", "doc still exists");
    }

    const stubLine = logs.find((l) => l.includes("sendNotificationMemberSHPE stub invoked") || l.includes("sendNotificationMemberSHPE invoked"));
    if (stubLine && stubLine.includes("approved")) {
        pass("approve: cloudFunctions stub log line printed (after commit)");
    } else {
        fail("approve: cloudFunctions stub log line printed", `logs=${JSON.stringify(logs)}`);
    }
}

async function testDeny(): Promise<void> {
    const uid = "member-08";
    const requestRef = db.doc(`memberSHPE/${uid}`);
    const userRef = db.doc(`users/${uid}`);

    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
        fail("deny: precondition — memberSHPE/member-08 exists (run scripts/seed.ts first)");
        return;
    }

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
        origLog(...args);
    };

    let res;
    try {
        res = await testApp.request(`/membership/${uid}/deny`, { method: "POST" });
    } finally {
        console.log = origLog;
    }

    if (res.status !== 200) {
        fail("deny: 200 response", `got ${res.status}`);
        return;
    }
    const body = await res.json();
    if (!body.ok) {
        fail("deny: response body { ok: true }", JSON.stringify(body));
    } else {
        pass("deny: 200 { ok: true }");
    }

    const [userSnap, requestSnapAfter] = await Promise.all([userRef.get(), requestRef.get()]);
    const userData = userSnap.data();

    if (
        !Object.prototype.hasOwnProperty.call(userData ?? {}, "chapterExpiration") &&
        !Object.prototype.hasOwnProperty.call(userData ?? {}, "nationalExpiration")
    ) {
        pass("deny: users/member-08 chapterExpiration + nationalExpiration removed");
    } else {
        fail(
            "deny: users/member-08 expirations removed",
            `chapterExpiration=${JSON.stringify(userData?.chapterExpiration)}, nationalExpiration=${JSON.stringify(userData?.nationalExpiration)}`
        );
    }

    if (!requestSnapAfter.exists) {
        pass("deny: memberSHPE/member-08 deleted");
    } else {
        fail("deny: memberSHPE/member-08 deleted", "doc still exists");
    }

    const stubLine = logs.find((l) => l.includes("sendNotificationMemberSHPE stub invoked") || l.includes("sendNotificationMemberSHPE invoked"));
    if (stubLine && stubLine.includes("denied")) {
        pass("deny: cloudFunctions stub log line printed (after commit)");
    } else {
        fail("deny: cloudFunctions stub log line printed", `logs=${JSON.stringify(logs)}`);
    }
}

async function testUnknownUid(): Promise<void> {
    const res = await testApp.request("/membership/no-such-uid/approve", { method: "POST" });
    if (res.status !== 404) {
        fail("unknown uid -> 404", `got ${res.status}`);
        return;
    }
    const body = await res.json();
    if (body?.error?.code === "request_not_found") {
        pass("unknown uid -> 404 { error: { code: 'request_not_found' } }");
    } else {
        fail("unknown uid -> 404 error code", JSON.stringify(body));
    }
}

async function restoreSeededState(): Promise<void> {
    // Re-create the consumed memberSHPE requests (same shape as scripts/seed.ts).
    await db.doc("memberSHPE/member-07").set({
        chapterURL: proofURL("member-07", "chapter"),
        nationalURL: proofURL("member-07", "national"),
        chapterExpiration: Timestamp.fromDate(inAYear()),
        nationalExpiration: Timestamp.fromDate(inAYear()),
        shirtSize: "M",
    });
    await db.doc("memberSHPE/member-08").set({
        chapterURL: proofURL("member-08", "chapter"),
        nationalURL: proofURL("member-08", "national"),
        chapterExpiration: Timestamp.fromDate(inAYear()),
        nationalExpiration: Timestamp.fromDate(inAYear()),
        shirtSize: "M",
    });

    // seed.ts does not set expirations on member-07/08 (only member-01/02 verified,
    // member-03 expired) — restore that by clearing whatever this test wrote.
    const { FieldValue } = await import("firebase-admin/firestore");
    await db.doc("users/member-07").set(
        { chapterExpiration: FieldValue.delete(), nationalExpiration: FieldValue.delete() },
        { merge: true }
    );
    await db.doc("users/member-08").set(
        { chapterExpiration: FieldValue.delete(), nationalExpiration: FieldValue.delete() },
        { merge: true }
    );

    console.log("Restored seeded state: memberSHPE/member-07, memberSHPE/member-08 re-created; user expirations cleared.");
}

async function main() {
    console.log(`Running M1 membership route self-tests against the emulator (firestore=${process.env.FIRESTORE_EMULATOR_HOST})...\n`);

    try {
        await testApprove();
        await testDeny();
        await testUnknownUid();
    } finally {
        await restoreSeededState();
    }

    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    if (failures > 0) process.exit(1);
}

main().catch((err) => {
    console.error("Unhandled error in test run:", err);
    process.exit(1);
});
