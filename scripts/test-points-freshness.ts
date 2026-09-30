/**
 * Regression test: the points query reads the roster through the shared
 * `['members']` cache entry, and must still show fresh totals after a write.
 * (`ensureQueryData` would serve the stale cached roster; `fetchQuery` honors
 * invalidation — see lib/hooks/usePoints.ts `fetchPointsData`.)
 *
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true bun run scripts/test-points-freshness.ts
 *
 * Needs the emulator + `bun run scripts/seed-stress.ts`. Emulator only.
 */

import "./lib/requireEmulator";

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    console.error("Refusing to run: set NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true on the command line.");
    process.exit(1);
}

const { QueryClient } = await import("@tanstack/react-query");
const { doc, updateDoc } = await import("firebase/firestore");
const { db } = await import("../app/config/firebaseClient");
const { fetchPointsData } = await import("../lib/hooks/usePoints");

let failures = 0;
const check = (label: string, ok: boolean) => {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
    if (!ok) failures++;
};

const uid = "stress-user-0500";
const userRef = doc(db, `users/${uid}`);
const qc = new QueryClient();
const totalOf = (data: Awaited<ReturnType<typeof fetchPointsData>>) =>
    data.rows.find((r) => r.uid === uid)!.totalPoints;

const before = totalOf(await fetchPointsData(qc));
try {
    await updateDoc(userRef, { points: before + 1000 });

    check(
        "within the share window, without invalidation, the cached roster is reused (dedupe)",
        totalOf(await fetchPointsData(qc)) === before
    );

    // What useEditPoints / useRecalculatePoints do on success.
    await qc.invalidateQueries({ queryKey: ["members"] });
    check(
        "after invalidating ['members'], the next points fetch shows the new total",
        totalOf(await fetchPointsData(qc)) === before + 1000
    );
} finally {
    await updateDoc(userRef, { points: before });
}

process.exit(failures ? 1 : 0);
