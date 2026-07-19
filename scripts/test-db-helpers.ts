/**
 * Self-test for server/lib/db-helpers.ts (BUILD_PLAN V1 acceptance criteria).
 *
 * Run with the emulators up: `bun run scripts/test-db-helpers.ts`
 * Admin SDK, no credentials — points at the Emulator Suite only.
 *
 * Verifies:
 *  1. A 251-edit input (502 writes) produces exactly 2 batches.
 *  2. An injected failing chunk reports failure (ChunkedBatchError), not
 *     silent partial success — and reports the correct partial-commit state.
 *  3. The startTime cache hits Firestore only once for repeated gets of the
 *     same eventId.
 *
 * Writes/reads only under a scratch collection (`_v1-test/*`) plus the
 * already-seeded `events/event-general-01` doc (read-only). Cleans up after.
 */

process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "tamushpemobileapp" });
const db = getFirestore(app);

import {
    chunkedAtomicBatch,
    makeEventTimesGetter,
    ChunkedBatchError,
    EventNotFoundError,
    type BatchWriteOp,
} from "../server/lib/db-helpers";

const SCRATCH_COLLECTION = "_v1-test";

let failures = 0;

function pass(label: string) {
    console.log(`PASS: ${label}`);
}

function fail(label: string, detail?: unknown) {
    failures += 1;
    console.log(`FAIL: ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}

async function cleanupScratch(): Promise<void> {
    const snap = await db.collection(SCRATCH_COLLECTION).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
}

async function test251Edits(): Promise<void> {
    const EDIT_COUNT = 251;
    const ops: BatchWriteOp[] = [];
    for (let i = 0; i < EDIT_COUNT; i++) {
        const docRef = db.collection(SCRATCH_COLLECTION).doc(`edit-${i}`);
        // 2 writes per "edit" (dual-write shape) -> same doc twice is fine for
        // this test since we only care about batch/write counts, but use two
        // distinct docs to mirror the real dual-write shape faithfully.
        const mirrorRef = db.collection(SCRATCH_COLLECTION).doc(`edit-${i}-mirror`);
        ops.push({ ref: docRef, data: { n: i } });
        ops.push({ ref: mirrorRef, data: { n: i } });
    }

    if (ops.length !== 502) {
        fail("251-edit input produces 502 writes", `got ${ops.length} ops`);
        return;
    }

    const result = await chunkedAtomicBatch(ops, db);

    if (result.batchesCommitted === 2 && result.writesApplied === 502) {
        pass("251-edit input (502 writes) -> exactly 2 batches committed, 502 writes applied");
    } else {
        fail(
            "251-edit input (502 writes) -> exactly 2 batches",
            `got batchesCommitted=${result.batchesCommitted}, writesApplied=${result.writesApplied}`
        );
    }
}

async function testInjectedFailure(): Promise<void> {
    // Chunk 1: 3 valid ops (should commit successfully).
    // Chunk 2: 1 op with a Firestore-reserved field name (`__reserved__` —
    // names matching /^__.*__$/ are rejected server-side at commit time),
    // reliably forcing a real commit() failure without any monkey-patching.
    const ops: BatchWriteOp[] = [];
    for (let i = 0; i < 3; i++) {
        ops.push({ ref: db.collection(SCRATCH_COLLECTION).doc(`ok-${i}`), data: { n: i } });
    }

    const badOps: BatchWriteOp[] = [
        ...ops,
        {
            ref: db.collection(SCRATCH_COLLECTION).doc("bad-1"),
            data: { __reserved__: "not allowed" },
        },
    ];

    let threw = false;
    let reportedCorrectly = false;
    try {
        // chunkSize of 3 so the first chunk (the 3 valid ops) commits
        // successfully, then a second chunk with the bad op fails.
        await chunkedAtomicBatch(badOps, db, 3);
    } catch (err) {
        threw = true;
        if (err instanceof ChunkedBatchError) {
            reportedCorrectly =
                err.failedChunkIndex === 1 &&
                err.totalChunks === 2 &&
                err.batchesCommitted === 1 &&
                err.writesApplied === 3;
        }
    }

    if (threw && reportedCorrectly) {
        pass("injected failing chunk -> ChunkedBatchError reports failed chunk + prior commits, not silent partial success");
    } else if (threw) {
        fail("injected failing chunk reports correct partial-commit state", "threw, but details did not match expectations");
    } else {
        fail("injected failing chunk -> should have thrown", "no error was thrown");
    }
}

async function testStartTimeCache(): Promise<void> {
    const eventId = "event-general-01";

    // Wrap the collection().doc().get() call count by spying on the
    // Firestore instance's `doc` method scoped to `events/{eventId}`.
    let getCallCount = 0;
    const originalDoc = db.doc.bind(db);
    (db as any).doc = (path: string) => {
        const ref = originalDoc(path);
        if (path === `events/${eventId}`) {
            const originalGet = ref.get.bind(ref);
            ref.get = () => {
                getCallCount += 1;
                return originalGet();
            };
        }
        return ref;
    };

    try {
        const getTimes = makeEventTimesGetter(db);
        const first = await getTimes(eventId);
        const second = await getTimes(eventId);

        if (!first?.startTime || !second?.startTime || !first?.endTime) {
            fail("event-times cache returns values", "got falsy startTime/endTime");
        } else if (first.startTime.isEqual(second.startTime) && getCallCount === 1) {
            pass("event-times cache: 2 gets for same eventId -> 1 Firestore read");
        } else {
            fail(
                "event-times cache: 2 gets for same eventId -> 1 Firestore read",
                `getCallCount=${getCallCount}, sameValue=${first?.startTime?.isEqual?.(second.startTime)}`
            );
        }
    } finally {
        (db as any).doc = originalDoc;
    }
}

async function testNotFound(): Promise<void> {
    const getTimes = makeEventTimesGetter(db);
    try {
        await getTimes("this-event-does-not-exist-v1-test");
        fail("missing event -> EventNotFoundError", "no error was thrown");
    } catch (err) {
        if (err instanceof EventNotFoundError) {
            pass("missing event -> EventNotFoundError thrown");
        } else {
            fail("missing event -> EventNotFoundError", err);
        }
    }
}

async function main() {
    console.log("Running V1 db-helpers self-tests against the emulator...\n");

    try {
        await test251Edits();
        await testInjectedFailure();
        await testStartTimeCache();
        await testNotFound();
    } finally {
        await cleanupScratch();
    }

    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    if (failures > 0) process.exit(1);
}

main().catch((err) => {
    console.error("Unhandled error in test run:", err);
    process.exit(1);
});
