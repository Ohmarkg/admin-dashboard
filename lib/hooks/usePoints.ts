import {
    queryOptions,
    useMutation,
    useQuery,
    useQueryClient,
    type QueryClient,
} from "@tanstack/react-query";
import {
    collection,
    collectionGroup,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    Timestamp,
    where,
} from "firebase/firestore";
import { db } from "@/config/firebaseClient";
import type { PrivateUserInfo, PublicUserInfo } from "@/types/user";
import type { SHPEEventLog } from "@/types/events";
import { authedFetch } from "@/lib/hooks/authedFetch";
import { eventsQueryOptions } from "@/lib/hooks/useEvents";
import { INSTAGRAM_EVENT_NAME } from "@/lib/hooks/useInstagramPoints";

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
/**
 * The single definition of the `['members']` cache entry. Exported so other
 * hooks can pull the roster through `queryClient.ensureQueryData(...)` rather
 * than issuing their own `getDocs(collection(db, "users"))` — a page that
 * needs the roster several times still costs exactly one collection read.
 * See `lib/hooks/useCommittees.ts`.
 */
export const membersQueryOptions = queryOptions({
    queryKey: ["members"],
    queryFn: fetchMembers,
});

export function useMembers() {
    return useQuery(membersQueryOptions);
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

export function buildMonthlyBuckets(
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

/**
 * How long the `['members']` / `['events']` entries may be reused by the points
 * query without a refetch. Invalidation (`useEditPoints`, `useRecalculatePoints`)
 * marks an entry stale regardless of this window, so a points refetch after a
 * write always re-reads the roster — the window only dedupes the page's parallel
 * `useEvents()` call and quick back-to-back visits.
 */
const SHARED_READ_STALE_MS = 30_000;

/**
 * Builds the points model in a constant number of Firestore queries — the
 * roster, the events list (both through the shared query cache), ONE
 * `event-logs` collection-group query bounded to the current school year, and
 * one `logs` read per hidden "Instagram Points" event. The previous version
 * issued a `users/{uid}/event-logs` query (plus a `privateInfo` read for users
 * with no public email) for every user — ~2N requests for N members.
 *
 * Needs production support (owned outside this repo — API.md § "Points
 * spreadsheet read"): a Firestore rule allowing staff to read the `event-logs`
 * collection group, and a collection-group index on `event-logs.creationTime`.
 *
 * `email` is the public email only (`""` when absent); the export fills the rest
 * on demand via `fillMissingEmails`.
 */
export async function fetchPointsData(queryClient: QueryClient): Promise<PointsData> {
    const now = new Date();
    const months = getCurrentSchoolYearMonths(now);
    const schoolYearLabel = getSchoolYearLabel(now);
    const schoolYearStart = new Date(getSchoolYearStartYear(now), 5, 1);

    // Only fetchQuery (not ensureQueryData) honors invalidation: ensureQueryData
    // would serve a stale-but-cached roster, showing pre-edit totals.
    const membersPromise = queryClient.fetchQuery({
        ...membersQueryOptions,
        staleTime: SHARED_READ_STALE_MS,
    });
    const eventsPromise = queryClient.fetchQuery({
        ...eventsQueryOptions,
        staleTime: SHARED_READ_STALE_MS,
    });

    // Every log created this school year, across all users, in one query. The
    // owning uid comes from the doc path (users/{uid}/event-logs/{eventId}).
    const schoolYearLogsPromise = getDocs(
        query(
            collectionGroup(db, "event-logs"),
            where("creationTime", ">=", Timestamp.fromDate(schoolYearStart))
        )
    );

    const [members, events] = await Promise.all([membersPromise, eventsPromise]);

    // Events named "Instagram Points" get their points tallied via
    // instagramLogs instead of the log's own `points` field (legacy
    // behavior) — collect their ids to exclude from the event-points sum.
    const instagramEventIds = new Set(
        events.filter((event) => event.name === INSTAGRAM_EVENT_NAME).map((event) => event.id)
    );

    // An Instagram log's `creationTime` is its FIRST award; later awards only
    // append to `instagramLogs`. The creationTime filter above would therefore
    // drop a member first awarded last school year who was awarded again this
    // year, so those logs are read from their event directly and the
    // collection-group copies of them are ignored (no double counting).
    const [schoolYearLogsSnapshot, instagramLogSnapshots] = await Promise.all([
        schoolYearLogsPromise,
        Promise.all(
            [...instagramEventIds].map((eventId) => getDocs(collection(db, `events/${eventId}/logs`)))
        ),
    ]);

    const logsByUid = new Map<string, SHPEEventLog[]>();
    const addLog = (uid: string, log: SHPEEventLog) => {
        const list = logsByUid.get(uid);
        if (list) list.push(log);
        else logsByUid.set(uid, [log]);
    };

    for (const logDoc of schoolYearLogsSnapshot.docs) {
        if (instagramEventIds.has(logDoc.id)) continue;
        const uid = logDoc.ref.parent.parent?.id;
        if (!uid) continue;
        addLog(uid, { ...(logDoc.data() as SHPEEventLog), eventId: logDoc.id });
    }
    instagramLogSnapshots.forEach((snapshot, index) => {
        const eventId = [...instagramEventIds][index];
        for (const logDoc of snapshot.docs) {
            addLog(logDoc.id, { ...(logDoc.data() as SHPEEventLog), eventId });
        }
    });

    const rows = members.map((member): PointsRow => {
        const eventLogs = logsByUid.get(member.uid) ?? [];
        return {
            uid: member.uid,
            displayName: member.displayName ?? "",
            email: member.email?.trim() ?? "",
            isOfficer: Boolean(member.roles?.officer),
            pointsRank: member.pointsRank,
            totalPoints: member.points ?? 0,
            eventLogs,
            months: buildMonthlyBuckets(eventLogs, instagramEventIds, months, now),
        };
    });

    return { schoolYearLabel, months, rows };
}

/**
 * Assembles the points spreadsheet model (total + per-month matrix for the
 * current school year, incl. Instagram-points columns), mirroring the legacy
 * points page's `fetchMembers`/`getPointsForMonth`/`calculateInstagramPoints`
 * — but computed once here instead of on every render.
 */
export function usePointsData() {
    const queryClient = useQueryClient();

    return useQuery({
        queryKey: ["points"],
        queryFn: () => fetchPointsData(queryClient),
    });
}

/**
 * Returns `rows` with `email` filled from `users/{uid}/private/privateInfo` for
 * every row whose public email is empty (mirrors the legacy fallback). Used by
 * the Excel export only — one read per such member, in small batches — so the
 * points screen itself never pays for it. Falls back to "Email not available".
 */
export async function fillMissingEmails(rows: PointsRow[], batchSize = 25): Promise<PointsRow[]> {
    const missing = rows.filter((row) => !row.email);
    const resolved = new Map<string, string>();

    for (let i = 0; i < missing.length; i += batchSize) {
        await Promise.all(
            missing.slice(i, i + batchSize).map(async (row) => {
                try {
                    const snap = await getDoc(doc(db, `users/${row.uid}/private/privateInfo`));
                    const email = (snap.data() as PrivateUserInfo | undefined)?.email?.trim();
                    if (email) resolved.set(row.uid, email);
                } catch (error) {
                    console.error(`Error fetching private info for user ${row.uid}:`, error);
                }
            })
        );
    }

    return rows.map((row) => ({
        ...row,
        email: row.email || resolved.get(row.uid) || "Email not available",
    }));
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
