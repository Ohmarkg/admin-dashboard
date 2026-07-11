/**
 * Shared server-side Firestore helpers (BUILD_PLAN V1).
 *
 * Plain TypeScript, no Next.js coupling. Consumed by server/routes/* (e.g. the
 * points dual-write in V2).
 */

import type {
    DocumentData,
    DocumentReference,
    Firestore,
} from "firebase-admin/firestore";
import { adminDb } from "@/server/firebaseAdmin";

// ---------------------------------------------------------------------------
// Chunked atomic batch helper
// ---------------------------------------------------------------------------

/** A single Firestore write op, expressed generically enough for `set`/`merge`. */
export type BatchWriteOp = {
    ref: DocumentReference;
    data: DocumentData;
    /** Defaults to false (overwrite). Pass true for a merge-set. */
    merge?: boolean;
};

/** Firestore's hard cap on writes per `WriteBatch`. */
export const FIRESTORE_BATCH_WRITE_LIMIT = 500;

export type ChunkedBatchResult = {
    /** Number of `WriteBatch`es committed successfully. */
    batchesCommitted: number;
    /** Total number of writes applied (sum across committed batches). */
    writesApplied: number;
};

/**
 * Thrown when a chunk fails to commit partway through a multi-chunk save.
 * Earlier chunks (see `batchesCommitted`/`writesApplied` on the error) are
 * already committed — cross-chunk atomicity is deliberately NOT provided
 * (API.md "still open" note / BUILD_PLAN V1 resolved note). Callers should
 * report this as a partial-failure, not retry the whole save blindly.
 */
export class ChunkedBatchError extends Error {
    /** 0-indexed position of the chunk that failed. */
    readonly failedChunkIndex: number;
    /** Total number of chunks the input was split into. */
    readonly totalChunks: number;
    /** Batches that committed successfully before the failure. */
    readonly batchesCommitted: number;
    /** Writes applied by batches that committed successfully before the failure. */
    readonly writesApplied: number;
    /** The underlying error thrown by the failed `commit()`. */
    readonly cause: unknown;

    constructor(args: {
        failedChunkIndex: number;
        totalChunks: number;
        batchesCommitted: number;
        writesApplied: number;
        cause: unknown;
    }) {
        super(
            `Chunked batch failed at chunk ${args.failedChunkIndex + 1}/${args.totalChunks}: ` +
                `${args.batchesCommitted} batch(es) (${args.writesApplied} writes) already committed ` +
                `before the failure. Cross-chunk atomicity is not provided — earlier chunks are NOT ` +
                `rolled back.`
        );
        this.name = "ChunkedBatchError";
        this.failedChunkIndex = args.failedChunkIndex;
        this.totalChunks = args.totalChunks;
        this.batchesCommitted = args.batchesCommitted;
        this.writesApplied = args.writesApplied;
        this.cause = args.cause;
    }
}

/**
 * Commits a list of write ops in one or more Firestore `WriteBatch`es,
 * chunked so no single batch exceeds `FIRESTORE_BATCH_WRITE_LIMIT` writes.
 *
 * Chunks commit SEQUENTIALLY and fail fast: if a chunk's `commit()` throws,
 * this stops immediately and throws a `ChunkedBatchError` reporting which
 * chunk failed and how much was already committed. Earlier chunks are NOT
 * rolled back (cross-chunk atomicity is deliberately out of scope — see
 * API.md "still open" note).
 *
 * @param ops       Flat list of writes (e.g. 2 per points edit for the dual-write).
 * @param chunkSize Max writes per batch. Defaults to the Firestore cap (500).
 */
export async function chunkedAtomicBatch(
    ops: BatchWriteOp[],
    db: Firestore = adminDb,
    chunkSize: number = FIRESTORE_BATCH_WRITE_LIMIT
): Promise<ChunkedBatchResult> {
    if (chunkSize <= 0 || chunkSize > FIRESTORE_BATCH_WRITE_LIMIT) {
        throw new Error(
            `chunkSize must be between 1 and ${FIRESTORE_BATCH_WRITE_LIMIT} (Firestore's per-batch write cap), got ${chunkSize}.`
        );
    }

    if (ops.length === 0) {
        return { batchesCommitted: 0, writesApplied: 0 };
    }

    const chunks: BatchWriteOp[][] = [];
    for (let i = 0; i < ops.length; i += chunkSize) {
        chunks.push(ops.slice(i, i + chunkSize));
    }

    let batchesCommitted = 0;
    let writesApplied = 0;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const batch = db.batch();
        for (const op of chunk) {
            batch.set(op.ref, op.data, { merge: !!op.merge });
        }

        try {
            await batch.commit();
        } catch (cause) {
            throw new ChunkedBatchError({
                failedChunkIndex: i,
                totalChunks: chunks.length,
                batchesCommitted,
                writesApplied,
                cause,
            });
        }

        batchesCommitted += 1;
        writesApplied += chunk.length;
    }

    return { batchesCommitted, writesApplied };
}

// ---------------------------------------------------------------------------
// Per-request event startTime cache
// ---------------------------------------------------------------------------

/** Thrown by the startTime getter when `events/{eventId}` does not exist. */
export class EventNotFoundError extends Error {
    readonly eventId: string;
    constructor(eventId: string) {
        super(`Event not found: events/${eventId}`);
        this.name = "EventNotFoundError";
        this.eventId = eventId;
    }
}

/**
 * Builds a per-request cache of `events/{id}.startTime` lookups. Repeated
 * calls for the same `eventId` within one request hit Firestore only once.
 * Throws `EventNotFoundError` if the event doc doesn't exist (routes map
 * this to a 404-ish response).
 *
 * Usage: `const getStartTime = makeEventStartTimeGetter(); await getStartTime(eventId);`
 */
export function makeEventStartTimeGetter(
    db: Firestore = adminDb
): (eventId: string) => Promise<FirebaseFirestore.Timestamp> {
    const cache = new Map<string, Promise<FirebaseFirestore.Timestamp>>();

    return function getEventStartTime(eventId: string): Promise<FirebaseFirestore.Timestamp> {
        const cached = cache.get(eventId);
        if (cached) return cached;

        const promise = (async () => {
            const snap = await db.doc(`events/${eventId}`).get();
            if (!snap.exists) {
                throw new EventNotFoundError(eventId);
            }
            const startTime = snap.get("startTime");
            if (!startTime) {
                throw new EventNotFoundError(eventId);
            }
            return startTime as FirebaseFirestore.Timestamp;
        })();

        cache.set(eventId, promise);
        return promise;
    };
}
