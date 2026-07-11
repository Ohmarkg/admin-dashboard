import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/config/firebaseClient";
import type { PrivateUserInfo, PublicUserInfo } from "@/types/user";
import type { SHPEEvent, SHPEEventLog } from "@/types/events";
import { authedFetch } from "@/lib/hooks/authedFetch";

// Client-side reads (API.md § Client-side reads: "Members / roster" and
// "Points spreadsheet"). Writes (edit/recalculate) go through the Hono
// `/api/points` routes — see server/routes/points.ts.

// ---------------------------------------------------------------------------
// School-year month bucketing (pure — no Firestore/DOM access)
// ---------------------------------------------------------------------------

/**
 * The points school year runs June (index 0) through May (index 11) of the
 * following calendar year (DATA_MODEL invariant 5). `now` defaults to today
 * and determines which school year is "current".
 */
export function getSchoolYearStartYear(now: Date = new Date()): number {
    return now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
}

/** e.g. "2025-2026" — mirrors the legacy `generateSchoolYear`. */
export function getSchoolYearLabel(now: Date = new Date()): string {
    const startYear = getSchoolYearStartYear(now);
    return `${startYear}-${startYear + 1}`;
}

/**
 * The 12 first-of-month `Date`s for the current school year, June through
 * May, in order (index 0 = June). Mirrors the legacy
 * `generateSchoolYearMonths`.
 */
export function getCurrentSchoolYearMonths(now: Date = new Date()): Date[] {
    const startYear = getSchoolYearStartYear(now);
    const months: Date[] = [];
    for (let i = 5; i < 12; i++) {
        months.push(new Date(startYear, i, 1)); // June..Dec of startYear
    }
    for (let i = 0; i < 5; i++) {
        months.push(new Date(startYear + 1, i, 1)); // Jan..May of startYear+1
    }
    return months;
}

/**
 * Maps `date` to its 0-based bucket index (0 = June ... 11 = May) within the
 * school year containing `now` (default: today). Returns `null` when `date`
 * falls outside that school year — such events/logs are excluded from the
 * monthly matrix entirely (rather than clamped into an adjacent bucket).
 *
 * Pure and Firestore/DOM-free by design so it can be unit-tested in
 * isolation — see scripts/test-points-bucketing.ts.
 */
export function schoolYearMonthIndex(date: Date, now: Date = new Date()): number | null {
    const startYear = getSchoolYearStartYear(now);
    const start = new Date(startYear, 5, 1);
    const end = new Date(startYear + 1, 5, 1);

    if (date < start || date >= end) {
        return null;
    }

    return (date.getFullYear() - startYear) * 12 + date.getMonth() - 5;
}

// ---------------------------------------------------------------------------
// useMembers — lean roster read
// ---------------------------------------------------------------------------

/** `users/{uid}` doc data plus the doc-id-derived `uid` (DATA_MODEL: uid is
 * set in code from `doc.id`, not always stored on the doc). */
export interface MemberPublic extends PublicUserInfo {
    uid: string;
}

async function fetchMembers(): Promise<MemberPublic[]> {
    const usersQuery = query(collection(db, "users"), orderBy("points", "desc"));
    const snapshot = await getDocs(usersQuery);
    return snapshot.docs.map((d) => ({ ...(d.data() as PublicUserInfo), uid: d.id }));
}

/**
 * `users/` roster ordered by `points desc`, mirroring the legacy `getMembers`
 * — but intentionally lean: unlike the legacy helper, this does NOT fetch
 * `private/privateInfo` or the `event-logs` subcollection for every member
 * (that's an N+1 read the plain roster view doesn't need). `usePointsData`
 * below does its own fetch of exactly the extra data the points screen
 * needs (private email fallback + event logs), so it doesn't depend on this
 * lean shape.
 */
export function useMembers() {
    return useQuery({
        queryKey: ["members"],
        queryFn: fetchMembers,
    });
}

// ---------------------------------------------------------------------------
// usePointsData — the points-screen spreadsheet model
// ---------------------------------------------------------------------------

export interface PointsMonthBucket {
    /** 0 = June ... 11 = May, matching `PointsData.months`. */
    monthIndex: number;
    /** First-of-month date for this bucket (same instance as `PointsData.months[monthIndex]`). */
    date: Date;
    /** Sum of event-log points in this month, excluding "Instagram Points" event logs. */
    points: number;
    /** Count of `instagramLogs` timestamps falling in this month (1 point each). */
    instagramPoints: number;
}

export interface PointsRow {
    uid: string;
    displayName: string;
    /** `publicInfo.email`, falling back to `private/privateInfo.email` (mirrors the legacy page). */
    email: string;
    isOfficer: boolean;
    pointsRank?: number;
    /** Aggregate total from `users/{uid}.points` — never hand-derived (DATA_MODEL invariant 4). */
    totalPoints: number;
    /** Raw per-event logs, kept for per-cell lookups (e.g. editing a single event's points). */
    eventLogs: SHPEEventLog[];
    /** 12-entry monthly matrix, index 0 = June ... 11 = May. */
    months: PointsMonthBucket[];
}

export interface PointsData {
    schoolYearLabel: string;
    /** 12 first-of-month dates, June..May — column headers for the monthly view. */
    months: Date[];
    rows: PointsRow[];
}

function buildMonthlyBuckets(
    eventLogs: SHPEEventLog[],
    instagramEventIds: Set<string>,
    months: Date[],
    now: Date
): PointsMonthBucket[] {
    const buckets: PointsMonthBucket[] = months.map((date, monthIndex) => ({
        monthIndex,
        date,
        points: 0,
        instagramPoints: 0,
    }));

    for (const log of eventLogs) {
        // Event points, excluding "Instagram Points" event logs (their points
        // are represented via instagramLogs below instead — mirrors the
        // legacy getPointsForMonth's isNotInstagramEvent filter).
        if (log.creationTime && !(log.eventId && instagramEventIds.has(log.eventId))) {
            const idx = schoolYearMonthIndex(log.creationTime.toDate(), now);
            if (idx !== null) {
                buckets[idx].points += log.points ?? 0;
            }
        }

        if (log.instagramLogs) {
            for (const ts of log.instagramLogs) {
                const idx = schoolYearMonthIndex(ts.toDate(), now);
                if (idx !== null) {
                    buckets[idx].instagramPoints += 1;
                }
            }
        }
    }

    return buckets;
}

async function fetchPointsData(): Promise<PointsData> {
    const now = new Date();
    const months = getCurrentSchoolYearMonths(now);
    const schoolYearLabel = getSchoolYearLabel(now);

    // Events named "Instagram Points" get their points tallied via
    // instagramLogs instead of the log's own `points` field (legacy
    // behavior) — collect their ids to exclude from the event-points sum.
    const eventsSnapshot = await getDocs(collection(db, "events"));
    const instagramEventIds = new Set(
        eventsSnapshot.docs
            .filter((d) => (d.data() as SHPEEvent).name === "Instagram Points")
            .map((d) => d.id)
    );

    const usersQuery = query(collection(db, "users"), orderBy("points", "desc"));
    const usersSnapshot = await getDocs(usersQuery);

    const rows = await Promise.all(
        usersSnapshot.docs.map(async (userDoc): Promise<PointsRow> => {
            const uid = userDoc.id;
            const publicInfo = userDoc.data() as PublicUserInfo;

            let email = publicInfo.email?.trim();
            if (!email) {
                try {
                    const privateSnap = await getDoc(doc(db, `users/${uid}/private/privateInfo`));
                    email = (privateSnap.data() as PrivateUserInfo | undefined)?.email;
                } catch (error) {
                    console.error(`Error fetching private info for user ${uid}:`, error);
                }
            }

            let eventLogs: SHPEEventLog[] = [];
            try {
                const logsSnapshot = await getDocs(collection(db, `users/${uid}/event-logs`));
                eventLogs = logsSnapshot.docs.map((d) => d.data() as SHPEEventLog);
            } catch (error) {
                console.error(`Error fetching event logs for user ${uid}:`, error);
            }

            return {
                uid,
                displayName: publicInfo.displayName ?? "",
                email: email || "Email not available",
                isOfficer: Boolean(publicInfo.roles?.officer),
                pointsRank: publicInfo.pointsRank,
                totalPoints: publicInfo.points ?? 0,
                eventLogs,
                months: buildMonthlyBuckets(eventLogs, instagramEventIds, months, now),
            };
        })
    );

    return { schoolYearLabel, months, rows };
}

/**
 * Assembles the points spreadsheet model (total + per-month matrix for the
 * current school year, incl. Instagram-points columns), mirroring the legacy
 * points page's `fetchMembers`/`getPointsForMonth`/`calculateInstagramPoints`
 * — but computed once here instead of on every render.
 */
export function usePointsData() {
    return useQuery({
        queryKey: ["points"],
        queryFn: fetchPointsData,
    });
}

// ---------------------------------------------------------------------------
// Mutations — Hono write routes
// ---------------------------------------------------------------------------

export interface PointsEdit {
    eventId: string;
    uid: string;
    points: number | null;
}

/**
 * `POST /api/points/edit` — batch of cell edits, one atomic dual-write batch
 * server-side (API.md; server/routes/points.ts). On success, invalidates
 * `['points']` and `['members']` so the grid + roster refresh without a
 * manual reload button.
 */
export function useEditPoints() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (edits: PointsEdit[]) => {
            const res = await authedFetch("/points/edit", {
                method: "POST",
                body: JSON.stringify({ edits }),
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["points"] });
            queryClient.invalidateQueries({ queryKey: ["members"] });
        },
    });
}

/**
 * `POST /api/points/recalculate` — invokes `updateAllUserPoints` server-side.
 * On success, invalidates `['points']` and `['members']`.
 */
export function useRecalculatePoints() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            const res = await authedFetch("/points/recalculate", { method: "POST" });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["points"] });
            queryClient.invalidateQueries({ queryKey: ["members"] });
        },
    });
}
