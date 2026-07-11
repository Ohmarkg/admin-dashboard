import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, onSnapshot, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/config/firebaseClient";
import type { PublicUserInfo } from "@/types/user";
import { isMemberVerified } from "@/types/membership";
import { authedFetch } from "@/lib/hooks/authedFetch";

// Client-side reads (API.md § Client-side reads: "Shirt list", "Resume-zip
// status / data"). Writes (shirt toggle) go through the Hono `/api/tools`
// routes — see server/routes/tools.ts. Mirrors the legacy
// `getShirtsToVerify` + OLD-tamu-shpe-admin-web/app/(main)/tools/page.tsx.

// ---------------------------------------------------------------------------
// useShirts — shirt-sizes joined with member public info
// ---------------------------------------------------------------------------

/** `shirt-sizes/{uid}` doc joined with `users/{uid}` public info. */
export interface ShirtRow {
    uid: string;
    shirtSize: string;
    shirtUploadDate: Timestamp;
    shirtPickedUp: boolean;
    /** Prefers `name`, falls back to `displayName`, mirroring the legacy tracker. */
    name: string;
    email: string;
    /** DATA_MODEL invariant 2 — both expirations present and ≥ now. */
    isMemberVerified: boolean;
}

async function fetchShirts(): Promise<ShirtRow[]> {
    const shirtSizesSnapshot = await getDocs(collection(db, "shirt-sizes"));

    return Promise.all(
        shirtSizesSnapshot.docs.map(async (shirtDoc): Promise<ShirtRow> => {
            const uid = shirtDoc.id;
            const data = shirtDoc.data();

            let publicInfo: PublicUserInfo | undefined;
            try {
                const userSnap = await getDoc(doc(db, "users", uid));
                publicInfo = userSnap.exists() ? (userSnap.data() as PublicUserInfo) : undefined;
            } catch (error) {
                console.error(`Error fetching public info for user ${uid}:`, error);
            }

            return {
                uid,
                shirtSize: data.shirtSize ?? "N/A",
                shirtUploadDate: data.shirtUploadDate ?? Timestamp.fromDate(new Date()),
                shirtPickedUp: Boolean(data.shirtPickedUp),
                name: publicInfo?.name || publicInfo?.displayName || "N/A",
                email: publicInfo?.email || "N/A",
                isMemberVerified: isMemberVerified(
                    publicInfo?.nationalExpiration,
                    publicInfo?.chapterExpiration
                ),
            };
        })
    );
}

/**
 * `shirt-sizes/` joined with member public info (API.md client-side reads:
 * "Shirt list"), mirroring the legacy `getShirtsToVerify` + `getMembers` join.
 */
export function useShirts() {
    return useQuery({
        queryKey: ["shirts"],
        queryFn: fetchShirts,
    });
}

// ---------------------------------------------------------------------------
// useToggleShirt — Hono write route
// ---------------------------------------------------------------------------

export interface ToggleShirtInput {
    uid: string;
    shirtPickedUp: boolean;
}

/**
 * `POST /api/tools/shirts/:uid/toggle` — flips `shirt-sizes/{uid}.shirtPickedUp`
 * server-side (API.md; server/routes/tools.ts). On success, invalidates
 * `['shirts']` so the tracker refreshes without a manual reload button.
 */
export function useToggleShirt() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ uid, shirtPickedUp }: ToggleShirtInput) => {
            const res = await authedFetch(`/tools/shirts/${uid}/toggle`, {
                method: "POST",
                body: JSON.stringify({ shirtPickedUp }),
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["shirts"] });
        },
    });
}

// ---------------------------------------------------------------------------
// useResumeStatus — raw onSnapshot listeners (push-based, outside TanStack
// Query per REBUILD_CONCEPT §5 and API.md's client-side reads table).
// ---------------------------------------------------------------------------

export interface ResumeStatus {
    isGenerated: boolean;
}

export interface ResumeData {
    url: string;
    createdAt: Timestamp;
    expiresAt: Timestamp;
}

export interface UseResumeStatusResult {
    status: ResumeStatus | null;
    data: ResumeData | null;
}

/**
 * Live listeners on `resumes/status` and `resumes/data` (DATA_MODEL §
 * resumes), mirroring the legacy Tools screen's `onSnapshot` pair. Not a
 * `useQuery` — this is push-based state the Cloud Function writes on its own
 * schedule, so a poll/refetch model doesn't fit (REBUILD_CONCEPT §5).
 */
export function useResumeStatus(): UseResumeStatusResult {
    const [status, setStatus] = useState<ResumeStatus | null>(null);
    const [data, setData] = useState<ResumeData | null>(null);

    useEffect(() => {
        const statusRef = doc(db, "resumes/status");
        const dataRef = doc(db, "resumes/data");

        const unsubscribeStatus = onSnapshot(statusRef, (snapshot) => {
            setStatus(snapshot.exists() ? (snapshot.data() as ResumeStatus) : null);
        });

        const unsubscribeData = onSnapshot(dataRef, (snapshot) => {
            setData(snapshot.exists() ? (snapshot.data() as ResumeData) : null);
        });

        return () => {
            unsubscribeStatus();
            unsubscribeData();
        };
    }, []);

    return { status, data };
}

// ---------------------------------------------------------------------------
// useZipResumes — the one deliberate client-side mutation-trigger exception
// (API.md § tools note): invokes the `zipResume` Cloud Function directly via
// `httpsCallable`, rather than a Hono route. Behind an emulator dev stub
// (BUILD_PLAN "Testing baseline" — `zipResume` is not emulated; Tools screen
// states are exercised by hand-editing `resumes/*` in the Emulator UI).
//
// Cutover note (X3): delete the `useEmulatorStub` branch below — the
// `httpsCallable` call is the permanent implementation on both paths.
// ---------------------------------------------------------------------------

const useEmulatorStub = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

async function callZipResume(): Promise<void> {
    if (useEmulatorStub) {
        // `zipResume` is a Cloud Function, not emulated locally (BUILD_PLAN
        // Testing baseline). Simulate a fire-and-forget trigger; exercise the
        // Tools screen's generating/ready/expired states by hand-editing
        // `resumes/status` and `resumes/data` in the Emulator UI (localhost:4000).
        console.log(
            "[useZipResumes] emulator stub: skipping real zipResume call — " +
                "hand-edit resumes/status and resumes/data in the Emulator UI to exercise states."
        );
        return;
    }

    const zipResumeFn = httpsCallable(functions, "zipResume");
    await zipResumeFn();
}

/**
 * Triggers the `zipResume` Cloud Function (API.md § tools "Resume-zip
 * trigger" — the one deliberate client-side mutation-trigger exception; not a
 * Firestore write, so it bypasses the Hono write boundary). Progress/result
 * are observed via `useResumeStatus`'s `onSnapshot` listeners, not this
 * mutation's return value.
 */
export function useZipResumes() {
    return useMutation({
        mutationFn: callZipResume,
    });
}
