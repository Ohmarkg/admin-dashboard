import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/config/firebaseClient";
import type { RequestWithDoc } from "@/types/membership";
import { isMemberVerified } from "@/types/membership";
import type { PublicUserInfo } from "@/types/user";
import { authedFetch } from "@/lib/hooks/authedFetch";
import { useMembers, type MemberPublic } from "@/lib/hooks/usePoints";

// Client-side reads (API.md § Client-side reads: "Membership requests" and
// "Official members"). Writes (approve/deny) go through the Hono
// `/api/membership` routes — see server/routes/membership.ts.

// Re-export `useMembers` so membership screens can pull the roster without
// duplicating the query defined in usePoints.ts (API.md: "Members / roster").
export { useMembers, type MemberPublic };

// ---------------------------------------------------------------------------
// useMembershipRequests — pending memberSHPE/ requests
// ---------------------------------------------------------------------------

/** A pending `memberSHPE/{uid}` request joined with the requester's name from
 * `users/{uid}` (DATA_MODEL: `RequestWithDoc` — `uid`/`name` are derived,
 * not stored on the request doc itself). */
export type MembershipRequestRow = RequestWithDoc;

async function fetchMembershipRequests(): Promise<MembershipRequestRow[]> {
    const snapshot = await getDocs(collection(db, "memberSHPE"));

    const requests: MembershipRequestRow[] = [];
    for (const requestDoc of snapshot.docs) {
        const data = requestDoc.data();

        // Validity rule (DATA_MODEL invariant / legacy getMembersToVerify):
        // a doc only counts as a real request when BOTH chapterURL and
        // nationalURL are non-empty. Excludes seeded invalid requests (e.g.
        // member-06, missing nationalURL).
        if (!data.chapterURL || !data.nationalURL) {
            continue;
        }

        const uid = requestDoc.id;
        const userSnap = await getDoc(doc(db, "users", uid));
        const name = userSnap.exists() ? (userSnap.data() as PublicUserInfo).name ?? "" : "";

        requests.push({
            name,
            uid,
            chapterURL: data.chapterURL,
            nationalURL: data.nationalURL,
            chapterExpiration: data.chapterExpiration,
            nationalExpiration: data.nationalExpiration,
            shirtSize: data.shirtSize,
        });
    }

    return requests;
}

/**
 * `memberSHPE/` pending requests, filtered to only valid submissions (both
 * proof URLs present) and joined with the requester's name — mirrors the
 * legacy `getMembersToVerify`.
 */
export function useMembershipRequests() {
    return useQuery({
        queryKey: ["membership", "requests"],
        queryFn: fetchMembershipRequests,
    });
}

// ---------------------------------------------------------------------------
// useOfficialMembers — users/ filtered to currently-verified members
// ---------------------------------------------------------------------------

async function fetchOfficialMembers(): Promise<MemberPublic[]> {
    const snapshot = await getDocs(collection(db, "users"));
    return snapshot.docs
        .map((d) => ({ ...(d.data() as PublicUserInfo), uid: d.id }))
        .filter((member) => isMemberVerified(member.nationalExpiration, member.chapterExpiration));
}

/**
 * `users/` filtered client-side to members whose `nationalExpiration` and
 * `chapterExpiration` both exist and are still valid (DATA_MODEL invariant
 * 2, `isMemberVerified`) — mirrors filtering the legacy `getMembers` by
 * `isMemberVerified`.
 */
export function useOfficialMembers() {
    return useQuery({
        queryKey: ["membership", "official"],
        queryFn: fetchOfficialMembers,
    });
}

// ---------------------------------------------------------------------------
// Mutations — Hono write routes
// ---------------------------------------------------------------------------

function invalidateMembershipQueries(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ["membership", "requests"] });
    queryClient.invalidateQueries({ queryKey: ["membership", "official"] });
    queryClient.invalidateQueries({ queryKey: ["members"] });
}

/**
 * `POST /api/membership/:uid/approve` — sets `users/{uid}` expirations from
 * the request and deletes `memberSHPE/{uid}` in one atomic batch server-side
 * (API.md; server/routes/membership.ts). On success, invalidates
 * `['membership','requests']`, `['membership','official']`, and `['members']`.
 */
export function useApproveMembership() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (uid: string) => {
            const res = await authedFetch(`/membership/${uid}/approve`, { method: "POST" });
            return res.json();
        },
        onSuccess: () => invalidateMembershipQueries(queryClient),
    });
}

/**
 * `POST /api/membership/:uid/deny` — clears `users/{uid}` expirations and
 * deletes `memberSHPE/{uid}` in one atomic batch server-side. On success,
 * invalidates `['membership','requests']`, `['membership','official']`, and
 * `['members']`.
 */
export function useDenyMembership() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (uid: string) => {
            const res = await authedFetch(`/membership/${uid}/deny`, { method: "POST" });
            return res.json();
        },
        onSuccess: () => invalidateMembershipQueries(queryClient),
    });
}
