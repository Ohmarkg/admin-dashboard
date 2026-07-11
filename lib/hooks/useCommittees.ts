import { useQuery } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/config/firebaseClient";
import type { Committee } from "@/types/committees";
import type { PublicUserInfo } from "@/types/user";

// Client-side read (API.md § Client-side reads: "Committees"; § committees
// note: read-only, NO router — committee editing is not a feature). Mirrors
// the legacy `getCommittees` (OLD-tamu-shpe-admin-web/app/api/firebaseUtils.ts:265).

/**
 * Resolves `head`/`leads` fields that may be stored either as an embedded
 * `PublicUserInfo` object (the seed/legacy shape — `getCommittees` spreads
 * `doc.data()` as-is, so `head`/`leads` pass through untouched) or, more
 * defensively, as a raw uid string (in case a doc was authored/edited by
 * hand or by another tool and only stored a reference). Embedded objects
 * pass through unchanged; a string uid triggers a `users/{uid}` lookup.
 */
async function resolvePublicUserInfo(
    value: PublicUserInfo | string | undefined
): Promise<PublicUserInfo | undefined> {
    if (!value) return undefined;
    if (typeof value !== "string") return value;

    try {
        const snap = await getDoc(doc(db, "users", value));
        if (!snap.exists()) return undefined;
        return { ...(snap.data() as PublicUserInfo), uid: snap.id };
    } catch (error) {
        console.error(`Error resolving user ${value} for committee head/leads:`, error);
        return undefined;
    }
}

async function fetchCommittees(): Promise<Committee[]> {
    const snapshot = await getDocs(collection(db, "committees"));

    return Promise.all(
        snapshot.docs.map(async (d): Promise<Committee> => {
            const data = d.data() as Committee;
            const [head, leads] = await Promise.all([
                resolvePublicUserInfo(data.head as unknown as PublicUserInfo | string | undefined),
                Promise.all(
                    ((data.leads as unknown as (PublicUserInfo | string)[] | undefined) ?? []).map(
                        (lead) => resolvePublicUserInfo(lead)
                    )
                ).then((resolved) => resolved.filter((l): l is PublicUserInfo => Boolean(l))),
            ]);

            return {
                ...data,
                firebaseDocName: d.id,
                head,
                leads,
            };
        })
    );
}

/**
 * `committees/` roster, read-only (DATA_MODEL committees section; API.md
 * committees note — no Hono router, committee editing isn't a feature).
 * `firebaseDocName` is set from `doc.id`, mirroring the legacy `getCommittees`.
 */
export function useCommittees() {
    return useQuery({
        queryKey: ["committees"],
        queryFn: fetchCommittees,
    });
}
