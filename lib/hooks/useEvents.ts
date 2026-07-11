import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/config/firebaseClient";
import type { PublicUserInfo } from "@/types/user";
import type { SHPEEvent, SHPEEventLog } from "@/types/events";
import { authedFetch } from "@/lib/hooks/authedFetch";

// Client-side read (API.md § Client-side reads: "Event roster / calendar").
// This file started as a MINIMAL read-only `useEvents()` for the V5 Points
// screen (needs it to resolve monthly event columns) and is extended here
// (BUILD_PLAN E2) with the event-logs/pending-events queries and the
// create/update/approve mutations that hit `/api/events` (server/routes/events.ts).
// `useEvents()` itself is unchanged so existing consumers (points screen)
// keep working.

/** `events/{id}` doc data plus the doc-id-derived `id`. */
export type EventWithId = SHPEEvent & { id: string };

async function fetchEvents(): Promise<EventWithId[]> {
    const snapshot = await getDocs(collection(db, "events"));
    return snapshot.docs.map((d) => ({ ...(d.data() as SHPEEvent), id: d.id }));
}

/** `events/` roster, unordered — mirrors the legacy `getEvents`. */
export function useEvents() {
    return useQuery({
        queryKey: ["events"],
        queryFn: fetchEvents,
    });
}

// ---------------------------------------------------------------------------
// useEventLogs — per-event log roster, joined with user display names
// ---------------------------------------------------------------------------

/** `events/{eventId}/logs/{uid}` doc data plus the doc-id-derived `uid`, joined
 * with the user's `displayName`/`name` (legacy `getEventLogs` only returned
 * the raw log; the admin UI needs a name to render each row, so this hook
 * does the join the legacy points/events pages did ad hoc at render time). */
export interface EventLogRow extends SHPEEventLog {
    uid: string;
    displayName: string;
}

async function fetchEventLogs(eventId: string): Promise<EventLogRow[]> {
    const snapshot = await getDocs(collection(db, `events/${eventId}/logs`));

    return Promise.all(
        snapshot.docs.map(async (logDoc): Promise<EventLogRow> => {
            const log = logDoc.data() as SHPEEventLog;
            const uid = logDoc.id;

            let displayName = "";
            try {
                const userSnap = await getDoc(doc(db, `users/${uid}`));
                displayName = (userSnap.data() as PublicUserInfo | undefined)?.displayName ?? "";
            } catch (error) {
                console.error(`Error fetching user ${uid} for event log:`, error);
            }

            return { ...log, uid, displayName };
        })
    );
}

/** `events/{eventId}/logs` roster, mirrors the legacy `getEventLogs` but
 * joins each row with the signer's `displayName` for display. */
export function useEventLogs(eventId: string) {
    return useQuery({
        queryKey: ["events", eventId, "logs"],
        queryFn: () => fetchEventLogs(eventId),
        enabled: Boolean(eventId),
    });
}

// ---------------------------------------------------------------------------
// usePendingEvents — events with at least one unverified log
// ---------------------------------------------------------------------------

/** An event plus its unverified logs (uid + name), for the pending-approval card. */
export interface PendingEvent {
    id: string;
    name: string;
    startTime?: Timestamp | null;
    unverifiedLogs: { uid: string; displayName: string }[];
}

/**
 * Derivation choice: the legacy app has no dedicated "pending events" helper
 * — it derives this in the events-list UI from `getEvents` + `getEventLogs`
 * per event. We mirror that (rather than a Firestore `collectionGroup("logs")`
 * query) for two reasons: (1) `verified` on `SHPEEventLog` is optional/no
 * default, so an inequality/`== false` collectionGroup query would miss docs
 * where the field is simply absent (unverified-by-omission), which is the
 * common case right after sign-in; (2) the event count here is small enough
 * that N per-event log reads (already paid for by `useEventLogs` elsewhere)
 * is simpler and correct-by-construction. Reads every event's `logs`
 * subcollection and keeps only events with >=1 log where `verified !== true`.
 */
async function fetchPendingEvents(): Promise<PendingEvent[]> {
    const eventsSnapshot = await getDocs(collection(db, "events"));

    const pending = await Promise.all(
        eventsSnapshot.docs.map(async (eventDoc): Promise<PendingEvent | null> => {
            const event = eventDoc.data() as SHPEEvent;
            const logs = await fetchEventLogs(eventDoc.id);
            const unverifiedLogs = logs
                .filter((log) => log.verified !== true)
                .map((log) => ({ uid: log.uid, displayName: log.displayName }));

            if (unverifiedLogs.length === 0) {
                return null;
            }

            return {
                id: eventDoc.id,
                name: event.name ?? "",
                startTime: event.startTime,
                unverifiedLogs,
            };
        })
    );

    return pending.filter((event): event is PendingEvent => event !== null);
}

/** Events with >=1 unverified log, for the pending-approvals card/list. */
export function usePendingEvents() {
    return useQuery({
        queryKey: ["events", "pending"],
        queryFn: fetchPendingEvents,
    });
}

// ---------------------------------------------------------------------------
// Mutations — Hono write routes
// ---------------------------------------------------------------------------

/** Timestamp fields serialized to `{seconds,nanoseconds}` for the wire (API.md
 * Conventions § Timestamps), keeping `geolocation` as a plain `{latitude,longitude}`
 * (matching the server's `geolocationSchema`). Other fields pass through as-is. */
type SerializedTimestamp = { seconds: number; nanoseconds: number };

/** Client-shaped event input: same fields as `SHPEEvent`, but `startTime`/
 * `endTime` may be a client `Timestamp` (or already-serialized) so pages can
 * pass either without caring about wire format. */
export type EventInput = Omit<Partial<SHPEEvent>, "startTime" | "endTime" | "geolocation"> & {
    startTime?: Timestamp | SerializedTimestamp | null;
    endTime?: Timestamp | SerializedTimestamp | null;
    geolocation?: { latitude: number; longitude: number } | null;
};

function serializeTimestamp(
    value: Timestamp | SerializedTimestamp | null | undefined
): SerializedTimestamp | null | undefined {
    if (value == null) {
        return value;
    }
    if (value instanceof Timestamp) {
        return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    return value;
}

function serializeEventInput(input: EventInput): Record<string, unknown> {
    const { startTime, endTime, ...rest } = input;
    const body: Record<string, unknown> = { ...rest };

    if ("startTime" in input) {
        body.startTime = serializeTimestamp(startTime);
    }
    if ("endTime" in input) {
        body.endTime = serializeTimestamp(endTime);
    }

    return body;
}

/**
 * `POST /api/events` — creates `events/{id}`. Accepts a client-shaped
 * `EventInput` (Timestamp fields serialized to `{seconds,nanoseconds}` here
 * so pages don't have to). Invalidates `['events']` + `['events','pending']`.
 */
export function useCreateEvent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: EventInput): Promise<{ id: string }> => {
            const res = await authedFetch("/events", {
                method: "POST",
                body: JSON.stringify(serializeEventInput(input)),
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["events"] });
            queryClient.invalidateQueries({ queryKey: ["events", "pending"] });
        },
    });
}

/**
 * `PUT /api/events/:id` — partial update of `events/{id}`. Same Timestamp
 * serialization as `useCreateEvent`. Invalidates `['events']`,
 * `['events', id, 'logs']`, and `['events','pending']`.
 */
export function useUpdateEvent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, input }: { id: string; input: EventInput }) => {
            const res = await authedFetch(`/events/${id}`, {
                method: "PUT",
                body: JSON.stringify(serializeEventInput(input)),
            });
            return res.json();
        },
        onSuccess: (_data, { id }) => {
            queryClient.invalidateQueries({ queryKey: ["events"] });
            queryClient.invalidateQueries({ queryKey: ["events", id, "logs"] });
            queryClient.invalidateQueries({ queryKey: ["events", "pending"] });
        },
    });
}

/**
 * `POST /api/events/:id/logs/:uid/approve` — verifies one attendee's log.
 * Invalidates `['events', eventId, 'logs']`, `['events','pending']`,
 * `['points']`, and `['members']` (points/roster reflect the now-verified log).
 */
export function useApproveLog() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ eventId, uid }: { eventId: string; uid: string }) => {
            const res = await authedFetch(`/events/${eventId}/logs/${uid}/approve`, {
                method: "POST",
            });
            return res.json();
        },
        onSuccess: (_data, { eventId }) => {
            queryClient.invalidateQueries({ queryKey: ["events", eventId, "logs"] });
            queryClient.invalidateQueries({ queryKey: ["events", "pending"] });
            queryClient.invalidateQueries({ queryKey: ["points"] });
            queryClient.invalidateQueries({ queryKey: ["members"] });
        },
    });
}

/**
 * `POST /api/events/:id/logs/bulk-approve` — verifies many attendees' logs at
 * once. Same invalidations as `useApproveLog`.
 */
export function useBulkApproveLogs() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ eventId, uids }: { eventId: string; uids: string[] }) => {
            const res = await authedFetch(`/events/${eventId}/logs/bulk-approve`, {
                method: "POST",
                body: JSON.stringify({ uids }),
            });
            return res.json();
        },
        onSuccess: (_data, { eventId }) => {
            queryClient.invalidateQueries({ queryKey: ["events", eventId, "logs"] });
            queryClient.invalidateQueries({ queryKey: ["events", "pending"] });
            queryClient.invalidateQueries({ queryKey: ["points"] });
            queryClient.invalidateQueries({ queryKey: ["members"] });
        },
    });
}
