/**
 * Benchmark + equivalence check for the Points page data fetch — emulator only.
 *
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true bun run scripts/bench-points.ts
 *
 * (The env var must be set on the command line: `.env.local` sets it to
 * `false`, which would point the CLIENT SDK at production. This script refuses
 * to run otherwise.) Seed first: `bun run scripts/seed-stress.ts`.
 *
 * Runs the ORIGINAL per-user fan-out implementation (copied below as `legacy`)
 * and the current `fetchPointsData`, on the same data, then asserts every row's
 * totals, monthly buckets and Instagram points are identical.
 */

import "./lib/requireEmulator";

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    console.error(
        "Refusing to run: NEXT_PUBLIC_USE_FIREBASE_EMULATORS must be 'true' (set it on the command line; .env.local sets it to false)."
    );
    process.exit(1);
}

// Dynamic imports so the guard above runs before config/firebaseClient reads env.
const { QueryClient } = await import("@tanstack/react-query");
const { collection, doc, getDoc, getDocs, orderBy, query } = await import("firebase/firestore");
const { db } = await import("../app/config/firebaseClient");
const points = await import("../lib/hooks/usePoints");
type SHPEEvent = import("../app/types/events").SHPEEvent;
type SHPEEventLog = import("../app/types/events").SHPEEventLog;
type PublicUserInfo = import("../app/types/user").PublicUserInfo;
type PrivateUserInfo = import("../app/types/user").PrivateUserInfo;
type PointsData = import("../lib/hooks/usePoints").PointsData;

const counters = { queries: 0, docs: 0 };
const countDocs = (n: number) => {
    counters.queries += 1;
    counters.docs += n;
};

/** The implementation this work replaced (verbatim logic, counters added). */
async function legacy(): Promise<PointsData> {
    const now = new Date();
    const months = points.getCurrentSchoolYearMonths(now);
    const schoolYearLabel = points.getSchoolYearLabel(now);

    const eventsSnapshot = await getDocs(collection(db, "events"));
    countDocs(eventsSnapshot.size);
    const instagramEventIds = new Set(
        eventsSnapshot.docs
            .filter((d) => (d.data() as SHPEEvent).name === "Instagram Points")
            .map((d) => d.id)
    );

    const usersSnapshot = await getDocs(query(collection(db, "users"), orderBy("points", "desc")));
    countDocs(usersSnapshot.size);

    const rows = await Promise.all(
        usersSnapshot.docs.map(async (userDoc) => {
            const uid = userDoc.id;
            const publicInfo = userDoc.data() as PublicUserInfo;

            let email = publicInfo.email?.trim();
            if (!email) {
                const privateSnap = await getDoc(doc(db, `users/${uid}/private/privateInfo`));
                countDocs(privateSnap.exists() ? 1 : 0);
                email = (privateSnap.data() as PrivateUserInfo | undefined)?.email;
            }

            const logsSnapshot = await getDocs(collection(db, `users/${uid}/event-logs`));
            countDocs(logsSnapshot.size);
            const eventLogs = logsSnapshot.docs.map((d) => d.data() as SHPEEventLog);

            return {
                uid,
                displayName: publicInfo.displayName ?? "",
                email: email || "Email not available",
                isOfficer: Boolean(publicInfo.roles?.officer),
                pointsRank: publicInfo.pointsRank,
                totalPoints: publicInfo.points ?? 0,
                eventLogs,
                months: points.buildMonthlyBuckets(eventLogs, instagramEventIds, months, now),
            };
        })
    );
    return { schoolYearLabel, months, rows };
}

async function timed<T>(label: string, fn: () => Promise<T>) {
    counters.queries = 0;
    counters.docs = 0;
    const start = performance.now();
    const result = await fn();
    const ms = performance.now() - start;
    console.log(
        `${label.padEnd(8)} ${ms.toFixed(0).padStart(6)} ms   ` +
            `rows=${(result as PointsData).rows.length}`
    );
    return { result, ms, ...counters };
}

// Warm the connection (first query pays channel setup) so neither run is penalized.
await getDocs(collection(db, "committees"));

const RUNS = 3;
const legacyRuns: number[] = [];
const newRuns: number[] = [];
let legacyData!: PointsData;
let newData!: PointsData;
let legacyCounts = { queries: 0, docs: 0 };

for (let i = 0; i < RUNS; i++) {
    const l = await timed("legacy", legacy);
    legacyRuns.push(l.ms);
    legacyData = l.result;
    legacyCounts = { queries: l.queries, docs: l.docs };

    // Fresh QueryClient each run = cold cache, like a first page visit.
    const n = await timed("new", () => points.fetchPointsData(new QueryClient()));
    newRuns.push(n.ms);
    newData = n.result;
}

// --- equivalence -----------------------------------------------------------
let mismatches = 0;
const legacyByUid = new Map(legacyData.rows.map((r) => [r.uid, r]));
if (legacyData.rows.length !== newData.rows.length) {
    console.log(`MISMATCH row count: legacy=${legacyData.rows.length} new=${newData.rows.length}`);
    mismatches++;
}
for (const row of newData.rows) {
    const old = legacyByUid.get(row.uid);
    if (!old) {
        console.log(`MISMATCH missing in legacy: ${row.uid}`);
        mismatches++;
        continue;
    }
    const same =
        old.totalPoints === row.totalPoints &&
        old.displayName === row.displayName &&
        old.isOfficer === row.isOfficer &&
        old.pointsRank === row.pointsRank &&
        old.months.every(
            (m, i) =>
                m.points === row.months[i].points && m.instagramPoints === row.months[i].instagramPoints
        );
    if (!same) {
        mismatches++;
        if (mismatches <= 5) {
            console.log(`MISMATCH ${row.uid}`, {
                legacy: old.months.map((m) => [m.points, m.instagramPoints]),
                next: row.months.map((m) => [m.points, m.instagramPoints]),
            });
        }
    }
}
// Order must match too (users ordered by points desc).
const sameOrder = legacyData.rows.every((r, i) => r.uid === newData.rows[i]?.uid);

// Monthly-cell base values: every log the Monthly grid would look up for this
// school year's events must be present in the new rows with the same points.
let cellMismatches = 0;
for (const row of newData.rows) {
    const old = legacyByUid.get(row.uid)!;
    for (const log of row.eventLogs) {
        const match = old.eventLogs.find((l) => l.eventId === log.eventId);
        if (!match || match.points !== log.points) cellMismatches++;
    }
}

// Email fallback on demand.
const missing = newData.rows.filter((r) => !r.email).length;
const filled = await points.fillMissingEmails(newData.rows);
const stillMissing = filled.filter((r) => r.email === "Email not available").length;

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log("\n=== summary (emulator, localhost latency) ===");
console.log(`legacy avg ${avg(legacyRuns).toFixed(0)} ms   queries=${legacyCounts.queries}   docs read=${legacyCounts.docs}`);
console.log(`new    avg ${avg(newRuns).toFixed(0)} ms   (queries = 2 cached reads + 1 collection-group + 1 per Instagram event)`);
console.log(`speedup ${(avg(legacyRuns) / avg(newRuns)).toFixed(1)}x`);
console.log(`row mismatches: ${mismatches}   order identical: ${sameOrder}   log-cell mismatches: ${cellMismatches}`);
console.log(`public-email missing: ${missing}   after fillMissingEmails still missing: ${stillMissing}`);
process.exit(mismatches || cellMismatches || !sameOrder ? 1 : 0);
