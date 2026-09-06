import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/config/firebaseClient";
import {
    committeeLogos,
    type Committee,
    type CommitteeInput,
    type CommitteeLogosName,
} from "@/types/committees";
import type { PublicUserInfo } from "@/types/user";
import { authedFetch } from "@/lib/hooks/authedFetch";
import { membersQueryOptions } from "@/lib/hooks/usePoints";

export interface CommitteeMember extends PublicUserInfo {
    uid: string;
}

export interface CommitteeRequestRow {
    committeeId: string;
    committeeName: string;
    uploadDate?: string;
    user: CommitteeMember;
}

export interface CommitteeMutationResult {
    ok?: true;
    id?: string;
    memberCount?: number;
    warning?: string;
    added?: number;
    removed?: boolean;
    membersRemoved?: number;
    requestsRemoved?: number;
}

function userFromReference(
    value: unknown,
    users: Map<string, CommitteeMember>
): PublicUserInfo | undefined {
    if (!value) return undefined;
    if (typeof value === "string") return users.get(value);
    if (typeof value === "object") {
        const embedded = value as PublicUserInfo;
        return embedded.uid ? users.get(embedded.uid) ?? embedded : embedded;
    }
    return undefined;
}

function usersFromReferences(value: unknown, users: Map<string, CommitteeMember>): PublicUserInfo[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => userFromReference(entry, users))
        .filter((entry): entry is PublicUserInfo => Boolean(entry));
}

/**
 * The `users/` roster as a uid-keyed map, read through the shared
 * `['members']` cache entry instead of a fresh collection scan. Both
 * `fetchCommittees` and `fetchCommitteeRequests` need the roster to hydrate
 * leadership/applicant records; going through `ensureQueryData` means landing
 * on /committees costs ONE `users` read that `useMembers` (the roster and
 * editor dialogs) then shares, rather than one scan per consumer.
 *
 * `invalidateCommitteeQueries` invalidates `['members']`, so a committee write
 * refreshes this shared entry along with the committee queries.
 */
async function loadUserMap(queryClient: QueryClient): Promise<Map<string, CommitteeMember>> {
    const members = await queryClient.ensureQueryData(membersQueryOptions);
    return new Map(members.map((member) => [member.uid, member]));
}

async function fetchCommittees(queryClient: QueryClient): Promise<Committee[]> {
    const [snapshot, users] = await Promise.all([
        getDocs(collection(db, "committees")),
        loadUserMap(queryClient),
    ]);

    const counts = new Map<string, number>();
    for (const user of users.values()) {
        for (const committeeId of user.committees ?? []) {
            counts.set(committeeId, (counts.get(committeeId) ?? 0) + 1);
        }
    }

    return snapshot.docs
        .map((committeeDoc): Committee => {
            const raw = committeeDoc.data() as Record<string, unknown>;
            const logo =
                typeof raw.logo === "string" && raw.logo in committeeLogos
                    ? (raw.logo as CommitteeLogosName)
                    : "default";
            return {
                firebaseDocName: committeeDoc.id,
                name: typeof raw.name === "string" ? raw.name : committeeDoc.id,
                color: typeof raw.color === "string" ? raw.color : "#500000",
                description: typeof raw.description === "string" ? raw.description : "",
                head: userFromReference(raw.head, users),
                representatives: usersFromReferences(raw.representatives, users),
                leads: usersFromReferences(raw.leads, users),
                applicationLink:
                    (typeof raw.applicationLink === "string" && raw.applicationLink) ||
                    (typeof raw.memberApplicationLink === "string" && raw.memberApplicationLink) ||
                    (typeof raw.leadApplicationLink === "string" && raw.leadApplicationLink) ||
                    "",
                logo,
                memberCount: counts.get(committeeDoc.id) ?? 0,
                isOpen: raw.isOpen === true,
            };
        })
        .sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name));
}

export function useCommittees() {
    const queryClient = useQueryClient();
    return useQuery({ queryKey: ["committees"], queryFn: () => fetchCommittees(queryClient) });
}

async function fetchCommitteeMembers(committeeId: string): Promise<CommitteeMember[]> {
    const snapshot = await getDocs(
        query(collection(db, "users"), where("committees", "array-contains", committeeId))
    );
    return snapshot.docs
        .map((userDoc) => ({ ...(userDoc.data() as PublicUserInfo), uid: userDoc.id }))
        .sort((a, b) => (a.name || a.displayName || "").localeCompare(b.name || b.displayName || ""));
}

export function useCommitteeMembers(committeeId: string | undefined) {
    return useQuery({
        queryKey: ["committees", committeeId, "members"],
        queryFn: () => fetchCommitteeMembers(committeeId!),
        enabled: Boolean(committeeId),
    });
}

async function fetchCommitteeRequests(queryClient: QueryClient): Promise<CommitteeRequestRow[]> {
    const [committeeSnapshot, users] = await Promise.all([
        getDocs(collection(db, "committees")),
        loadUserMap(queryClient),
    ]);
    const rows = await Promise.all(
        committeeSnapshot.docs.map(async (committeeDoc) => {
            const requestSnapshot = await getDocs(
                collection(db, "committeeVerification", committeeDoc.id, "requests")
            );
            const name = (committeeDoc.data().name as string | undefined) || committeeDoc.id;
            return requestSnapshot.docs
                .map((requestDoc): CommitteeRequestRow | null => {
                    const user = users.get(requestDoc.id);
                    if (!user) return null;
                    const uploadDate = requestDoc.data().uploadDate;
                    return {
                        committeeId: committeeDoc.id,
                        committeeName: name,
                        uploadDate: typeof uploadDate === "string" ? uploadDate : undefined,
                        user,
                    };
                })
                .filter((row): row is CommitteeRequestRow => Boolean(row));
        })
    );
    return rows.flat().sort((a, b) => a.committeeName.localeCompare(b.committeeName));
}

export function useCommitteeRequests() {
    const queryClient = useQueryClient();
    return useQuery({ queryKey: ["committee-requests"], queryFn: () => fetchCommitteeRequests(queryClient) });
}

/** `['committees']` prefix-matches `['committees', id, 'members']`, so the
 * per-committee roster entries are covered by the first call. `['members']` is
 * the shared roster read that `loadUserMap` depends on. */
function invalidateCommitteeQueries(queryClient: QueryClient) {
    queryClient.invalidateQueries({ queryKey: ["committees"] });
    queryClient.invalidateQueries({ queryKey: ["committee-requests"] });
    queryClient.invalidateQueries({ queryKey: ["members"] });
}

function committeeWireBody(input: CommitteeInput): Record<string, unknown> {
    return { ...input, head: input.head ?? null };
}

export function useCreateCommittee() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (input: CommitteeInput): Promise<CommitteeMutationResult> =>
            (await authedFetch("/committees", { method: "POST", body: JSON.stringify(committeeWireBody(input)) })).json(),
        onSuccess: () => invalidateCommitteeQueries(queryClient),
    });
}

export function useUpdateCommittee() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: string; input: CommitteeInput }): Promise<CommitteeMutationResult> =>
            (await authedFetch(`/committees/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(committeeWireBody(input)) })).json(),
        onSuccess: () => invalidateCommitteeQueries(queryClient),
    });
}

export function useAddCommitteeMembers() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, uids }: { id: string; uids: string[] }): Promise<CommitteeMutationResult> =>
            (await authedFetch(`/committees/${encodeURIComponent(id)}/members`, { method: "POST", body: JSON.stringify({ uids }) })).json(),
        onSuccess: () => invalidateCommitteeQueries(queryClient),
    });
}

export function useRemoveCommitteeMember() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, uid }: { id: string; uid: string }): Promise<CommitteeMutationResult> =>
            (await authedFetch(`/committees/${encodeURIComponent(id)}/members/${encodeURIComponent(uid)}`, { method: "DELETE" })).json(),
        onSuccess: () => invalidateCommitteeQueries(queryClient),
    });
}

function useDecideCommitteeRequest(action: "approve" | "deny") {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ committeeId, uid }: { committeeId: string; uid: string }): Promise<CommitteeMutationResult> =>
            (await authedFetch(`/committees/${encodeURIComponent(committeeId)}/requests/${encodeURIComponent(uid)}/${action}`, { method: "POST" })).json(),
        onSuccess: () => invalidateCommitteeQueries(queryClient),
    });
}

export const useApproveCommitteeRequest = () => useDecideCommitteeRequest("approve");
export const useDenyCommitteeRequest = () => useDecideCommitteeRequest("deny");

export function useResetCommittee() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: string): Promise<CommitteeMutationResult> =>
            (await authedFetch(`/committees/${encodeURIComponent(id)}/reset`, { method: "POST" })).json(),
        onSuccess: () => invalidateCommitteeQueries(queryClient),
    });
}

export function useDeleteCommittee() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: string): Promise<CommitteeMutationResult> =>
            (await authedFetch(`/committees/${encodeURIComponent(id)}`, { method: "DELETE" })).json(),
        onSuccess: () => invalidateCommitteeQueries(queryClient),
    });
}
