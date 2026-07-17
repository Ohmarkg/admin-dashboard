import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/config/firebaseClient";
import type { PrivateUserInfo, PublicUserInfo } from "@/types/user";
import type { SHPEEvent, SHPEEventLog } from "@/types/events";
import { EventType } from "@/types/events";
import { isMemberVerified } from "@/types/membership";
import { authedFetch } from "@/lib/hooks/authedFetch";

// Client-side read (API.md § Client-side reads: convention-tracking roster
// joined with member public info). Writes (track/untrack) go through the Hono
// `/api/conventions` routes — see server/routes/conventions.ts.

// ---------------------------------------------------------------------------
// Attendance-count derivation (pure — no Firestore/DOM access)
// ---------------------------------------------------------------------------

/** Number of qualifying attendances required per category for eligibility. */
export const REQUIRED_COUNT = 2;

export interface ConventionCounts {
    volunteer: number;
    workshop: number;
    generalMeeting: number;
}

/**
 * Maps an event's `eventType` to the `ConventionCounts` bucket it counts
 * toward. Event types not listed here (e.g. Social Event) don't count toward
 * convention eligibility at all.
 */
const CATEGORY_BY_EVENT_TYPE: Record<string, keyof ConventionCounts> = {
    [EventType.VOLUNTEER_EVENT]: "volunteer",
    [EventType.WORKSHOP]: "workshop",
    [EventType.GENERAL_MEETING]: "generalMeeting",
};

/**
 * Tallies a member's `event-logs` into per-category convention-attendance
 * counts. A log only counts when BOTH `signInTime` AND `signOutTime` are
 * present — `signInTime` alone is not a reliable "attended" signal, since the
 * points editor can backfill/edit a log's points without necessarily setting
 * a sign-out (see server/routes/points.ts) — and its event's `eventType` maps
 * to one of the three tracked categories via `CATEGORY_BY_EVENT_TYPE`.
 */
export function deriveConventionCounts(
    logs: SHPEEventLog[],
    eventTypeById: Map<string, string>
): ConventionCounts {
    const counts: ConventionCounts = { volunteer: 0, workshop: 0, generalMeeting: 0 };

    for (const log of logs) {
        if (!log.signInTime || !log.signOutTime) {
            continue;
        }

        const eventType = eventTypeById.get(log.eventId ?? "");
        const category = eventType ? CATEGORY_BY_EVENT_TYPE[eventType] : undefined;
        if (category) {
            counts[category] += 1;
        }
    }

    return counts;
}

/** A member is convention-eligible once every category meets `REQUIRED_COUNT`. */
export function isConventionEligible(counts: ConventionCounts): boolean {
    return (
        counts.volunteer >= REQUIRED_COUNT &&
        counts.workshop >= REQUIRED_COUNT &&
        counts.generalMeeting >= REQUIRED_COUNT
    );
}

// ---------------------------------------------------------------------------
// useConventionTracking — convention-tracking roster joined with users
// ---------------------------------------------------------------------------

export interface ConventionRow {
    uid: string;
    name: string;
    email: string;
    isMemberVerified: boolean;
    dateAdded: Timestamp;
    counts: ConventionCounts;
    eligible: boolean;
}

async function fetchConventionData(): Promise<ConventionRow[]> {
    const trackingSnapshot = await getDocs(collection(db, "convention-tracking"));
    if (trackingSnapshot.empty) {
        return [];
    }

    const eventsSnapshot = await getDocs(collection(db, "events"));
    const eventTypeById = new Map(
        eventsSnapshot.docs.map((d) => [d.id, (d.data() as SHPEEvent).eventType ?? ""])
    );

    return Promise.all(
        trackingSnapshot.docs.map(async (trackingDoc): Promise<ConventionRow> => {
            const uid = trackingDoc.id;
            const trackingData = trackingDoc.data();

            let publicInfo: PublicUserInfo | undefined;
            try {
                const userSnap = await getDoc(doc(db, "users", uid));
                publicInfo = userSnap.exists() ? (userSnap.data() as PublicUserInfo) : undefined;
            } catch (error) {
                console.error(`Error fetching public info for user ${uid}:`, error);
            }

            let email = publicInfo?.email?.trim();
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

            const counts = deriveConventionCounts(eventLogs, eventTypeById);

            return {
                uid,
                name: publicInfo?.name || publicInfo?.displayName || "N/A",
                email: email || "N/A",
                isMemberVerified: isMemberVerified(
                    publicInfo?.nationalExpiration,
                    publicInfo?.chapterExpiration
                ),
                dateAdded: (trackingData.dateAdded as Timestamp | undefined) ?? Timestamp.now(),
                counts,
                eligible: isConventionEligible(counts),
            };
        })
    );
}

/**
 * `convention-tracking/` roster joined with member public info and derived
 * attendance counts (API.md client-side reads), mirroring the shirt/points
 * hooks' join pattern.
 */
export function useConventionTracking() {
    return useQuery({
        queryKey: ["conventions"],
        queryFn: fetchConventionData,
    });
}

// ---------------------------------------------------------------------------
// Mutations — Hono write routes
// ---------------------------------------------------------------------------

export interface TrackMembersResult {
    ok: true;
    tracked: string[];
    alreadyTracked: string[];
    unknownUids: string[];
}

/**
 * `POST /api/conventions/track` — adds `uids` to the convention-tracking
 * roster server-side (API.md; server/routes/conventions.ts). On success,
 * invalidates `['conventions']` so the tracker refreshes without a manual
 * reload button.
 */
export function useTrackMembers() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (uids: string[]): Promise<TrackMembersResult> => {
            const res = await authedFetch("/conventions/track", {
                method: "POST",
                body: JSON.stringify({ uids }),
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["conventions"] });
        },
    });
}

/**
 * `POST /api/conventions/:uid/untrack` — removes `uid` from the
 * convention-tracking roster server-side (API.md; server/routes/conventions.ts).
 * On success, invalidates `['conventions']`.
 */
export function useUntrackMember() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (uid: string) => {
            const res = await authedFetch(`/conventions/${uid}/untrack`, { method: "POST" });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["conventions"] });
        },
    });
}
