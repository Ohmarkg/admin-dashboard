import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, limit, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/config/firebaseClient";
import type { PrivateUserInfo, PublicUserInfo } from "@/types/user";
import type { SHPEEventLog } from "@/types/events";
import { isMemberVerified } from "@/types/membership";
import { authedFetch } from "@/lib/hooks/authedFetch";

// Client-side read (API.md § Client-side reads: hidden Instagram Points event's
// logs joined with member public info). Awards go through the Hono
// `/api/instagram` routes — see server/routes/instagram.ts.

/** Name of the hidden event that holds all Instagram-point logs. */
export const INSTAGRAM_EVENT_NAME = "Instagram Points";

export interface InstagramPointsRow {
    uid: string;
    name: string;
    email: string;
    isMemberVerified: boolean;
    points: number;
    awardCount: number;
    lastAwarded: Timestamp | null;
    instagramLogs: Timestamp[];
}

export interface InstagramPointsData {
    /** `null` until the first award creates the hidden event server-side. */
    eventId: string | null;
    rows: InstagramPointsRow[];
}

async function fetchInstagramPointsData(): Promise<InstagramPointsData> {
    const eventSnapshot = await getDocs(
        query(collection(db, "events"), where("name", "==", INSTAGRAM_EVENT_NAME), limit(1))
    );
    if (eventSnapshot.empty) {
        return { eventId: null, rows: [] };
    }

    const eventId = eventSnapshot.docs[0].id;
    const logsSnapshot = await getDocs(collection(db, `events/${eventId}/logs`));

    const rows = await Promise.all(
        logsSnapshot.docs.map(async (logDoc): Promise<InstagramPointsRow> => {
            const uid = logDoc.id;
            const log = logDoc.data() as SHPEEventLog;

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

            const instagramLogs = log.instagramLogs ?? [];

            return {
                uid,
                name: publicInfo?.name || publicInfo?.displayName || "N/A",
                email: email || "N/A",
                isMemberVerified: isMemberVerified(
                    publicInfo?.nationalExpiration,
                    publicInfo?.chapterExpiration
                ),
                points: log.points ?? 0,
                awardCount: instagramLogs.length,
                lastAwarded: instagramLogs[instagramLogs.length - 1] ?? null,
                instagramLogs,
            };
        })
    );

    // Most recently awarded first; never-awarded rows sink to the bottom.
    rows.sort((a, b) => {
        if (!a.lastAwarded) return b.lastAwarded ? 1 : 0;
        if (!b.lastAwarded) return -1;
        return b.lastAwarded.toMillis() - a.lastAwarded.toMillis();
    });

    return { eventId, rows };
}

/**
 * Hidden `Instagram Points` event's `logs/` subcollection joined with member
 * public info (API.md client-side reads), mirroring the convention tracker's
 * join pattern. `eventId` is `null` until the first award creates the event.
 */
export function useInstagramPoints() {
    return useQuery({
        queryKey: ["instagram-points"],
        queryFn: fetchInstagramPointsData,
    });
}

// ---------------------------------------------------------------------------
// Mutations — Hono write routes
// ---------------------------------------------------------------------------

export interface AwardInstagramPointsResult {
    ok: true;
    eventId: string;
    awarded: string[];
    unknownUids: string[];
    pointsPerAward: number;
}

/**
 * `POST /api/instagram/award` — awards Instagram points to `uids` server-side
 * (API.md; server/routes/instagram.ts), creating the hidden event on the
 * first award. On success, invalidates `['instagram-points']` and `['points']`
 * (the Monthly Points screen shows Instagram columns).
 */
export function useAwardInstagramPoints() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (uids: string[]): Promise<AwardInstagramPointsResult> => {
            const res = await authedFetch("/instagram/award", {
                method: "POST",
                body: JSON.stringify({ uids }),
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["instagram-points"] });
            queryClient.invalidateQueries({ queryKey: ["points"] });
        },
    });
}
