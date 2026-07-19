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

/** The slice of an event the tracker needs to attribute an attendance. */
export interface ConventionEventInfo {
    eventType: string;
    name: string | null;
    startTime: Timestamp | null;
}

/** One qualifying attendance: the event behind a unit of a category count. */
export interface ConventionAttendedEvent {
    eventId: string;
    name: string | null;
    startTime: Timestamp | null;
}

export interface ConventionAttendance {
    volunteer: ConventionAttendedEvent[];
    workshop: ConventionAttendedEvent[];
    generalMeeting: ConventionAttendedEvent[];
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
 * Buckets a member's `event-logs` into the qualifying events behind each
 * convention-attendance category. A log only counts when BOTH `signInTime`
 * AND `signOutTime` are present — `signInTime` alone is not a reliable
 * "attended" signal (a mobile sign-in the member never signed out of).
 * Points-editor backfills write both times (server/routes/points.ts, issue
 * #7), so spreadsheet-backfilled attendance counts here; only genuine
 * sign-in-without-sign-out logs are excluded. The event's `eventType` must
 * also map to one of the three tracked categories via
 * `CATEGORY_BY_EVENT_TYPE`. Within each category, events are sorted by
 * `startTime` ascending (unknown start times last).
 */
export function deriveConventionAttendance(
    logs: SHPEEventLog[],
    eventById: Map<string, ConventionEventInfo>
): ConventionAttendance {
    const attendance: ConventionAttendance = {
        volunteer: [],
        workshop: [],
        generalMeeting: [],
    };

    for (const log of logs) {
        if (!log.signInTime || !log.signOutTime) {
            continue;
        }

        const eventId = log.eventId ?? "";
        const event = eventById.get(eventId);
        const category = event ? CATEGORY_BY_EVENT_TYPE[event.eventType] : undefined;
        if (event && category) {
            attendance[category].push({
                eventId,
                name: event.name,
                startTime: event.startTime,
            });
        }
    }

    const byStartTime = (a: ConventionAttendedEvent, b: ConventionAttendedEvent) => {
        if (!a.startTime) return b.startTime ? 1 : 0;
        if (!b.startTime) return -1;
        return a.startTime.toMillis() - b.startTime.toMillis();
    };
    attendance.volunteer.sort(byStartTime);
    attendance.workshop.sort(byStartTime);
    attendance.generalMeeting.sort(byStartTime);

    return attendance;
}

/**
 * Per-category convention-attendance counts — always the lengths of
 * `deriveConventionAttendance`'s buckets, so the counts shown in the table
 * can never disagree with the event lists behind them.
 */
export function deriveConventionCounts(
    logs: SHPEEventLog[],
    eventById: Map<string, ConventionEventInfo>
): ConventionCounts {
    const attendance = deriveConventionAttendance(logs, eventById);
    return {
        volunteer: attendance.volunteer.length,
        workshop: attendance.workshop.length,
        generalMeeting: attendance.generalMeeting.length,
    };
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
    attendance: ConventionAttendance;
    eligible: boolean;
}

async function fetchConventionData(): Promise<ConventionRow[]> {
    const trackingSnapshot = await getDocs(collection(db, "convention-tracking"));
    if (trackingSnapshot.empty) {
        return [];
    }

    const eventsSnapshot = await getDocs(collection(db, "events"));
    const eventById = new Map<string, ConventionEventInfo>(
        eventsSnapshot.docs.map((d) => {
            const event = d.data() as SHPEEvent;
            return [
                d.id,
                {
                    eventType: event.eventType ?? "",
                    name: event.name ?? null,
                    startTime: event.startTime ?? null,
                },
            ];
        })
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

            const attendance = deriveConventionAttendance(eventLogs, eventById);
            const counts: ConventionCounts = {
                volunteer: attendance.volunteer.length,
                workshop: attendance.workshop.length,
                generalMeeting: attendance.generalMeeting.length,
            };

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
                attendance,
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
