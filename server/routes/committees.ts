import { Context, Hono } from "hono";
import { z } from "zod";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firebaseAdmin";
import type { AuthVariables } from "@/server/middleware/auth";
import { sendNotificationCommitteeRequest } from "@/server/lib/cloudFunctions";
const logoValues = [
    "professionalDevelopment", "internalAffairs", "secretary", "treasurer",
    "jonesSHPEjr", "publicRelations", "scholasticCommittee", "presidentsCommittee",
    "mentorshpeCommittee", "shpetinas", "technicalAffairs", "default",
] as const;
const uidArray = z.array(z.string().min(1)).default([]).transform((uids) => [...new Set(uids)]);
const optionalUrl = z.union([z.literal(""), z.string().url()]).default("");

const committeeBodySchema = z.object({
    name: z.string().trim().min(1).max(100),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a six-digit hex value."),
    description: z.string().max(250).default(""),
    head: z.union([z.string().min(1), z.null()]).optional().transform((value) => value ?? undefined),
    representatives: uidArray,
    leads: uidArray,
    applicationLink: optionalUrl,
    logo: z.enum(logoValues),
    isOpen: z.boolean(),
});

const addMembersSchema = z.object({ uids: z.array(z.string().min(1)).min(1).max(200) });
const MAX_ATOMIC_WRITES = 500;

type CommitteeBody = z.infer<typeof committeeBodySchema>;
type UserRow = { uid: string; ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData };
type CommitteeContext = Context<{ Variables: AuthVariables }>;

class RouteError extends Error {
    constructor(public status: 400 | 404 | 409, public code: string, message: string, public details?: unknown) {
        super(message);
    }
}

function errorResponse(c: CommitteeContext, error: unknown) {
    if (error instanceof RouteError) {
        return c.json({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
    }
    console.error("Committee route failed:", error);
    return c.json({ error: { code: "internal_error", message: "Committee operation failed." } }, 500);
}

function committeeSlugFromName(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function uidFromLegacy(value: unknown): string | undefined {
    if (typeof value === "string") return value || undefined;
    if (value && typeof value === "object" && typeof (value as { uid?: unknown }).uid === "string") {
        return (value as { uid: string }).uid || undefined;
    }
    return undefined;
}

function uidListFromLegacy(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(uidFromLegacy).filter((uid): uid is string => Boolean(uid)))];
}

function canonicalFromStored(id: string, raw: FirebaseFirestore.DocumentData): CommitteeBody {
    const fallbackLink = raw.memberApplicationLink || raw.leadApplicationLink || "";
    const parsed = committeeBodySchema.safeParse({
        name: raw.name || id,
        color: raw.color || "#500000",
        description: raw.description || "",
        head: uidFromLegacy(raw.head),
        representatives: uidListFromLegacy(raw.representatives),
        leads: uidListFromLegacy(raw.leads),
        applicationLink: raw.applicationLink || fallbackLink,
        logo: logoValues.includes(raw.logo as (typeof logoValues)[number]) ? raw.logo : "default",
        isOpen: raw.isOpen === true,
    });
    if (!parsed.success) throw new RouteError(409, "invalid_committee_data", `Committee ${id} contains invalid legacy data.`);
    return parsed.data;
}

function leadershipUids(body: CommitteeBody): string[] {
    return [...new Set([...(body.head ? [body.head] : []), ...body.leads, ...body.representatives])];
}

async function loadUsers(uids: string[]): Promise<Map<string, UserRow>> {
    const unique = [...new Set(uids)];
    const snaps = await Promise.all(unique.map((uid) => adminDb.doc(`users/${uid}`).get()));
    const users = new Map<string, UserRow>();
    snaps.forEach((snap, index) => {
        if (!snap.exists) throw new RouteError(400, "invalid_user", `User not found: ${unique[index]}.`);
        users.set(unique[index], { uid: unique[index], ref: snap.ref, data: snap.data() ?? {} });
    });
    return users;
}

async function validateLeadership(body: CommitteeBody): Promise<Map<string, UserRow>> {
    const users = await loadUsers(leadershipUids(body));
    if (body.head) {
        const roles = users.get(body.head)!.data.roles ?? {};
        if (!(roles.officer || roles.lead || roles.representative)) {
            throw new RouteError(400, "invalid_head_role", "The committee head must be an officer, lead, or representative.");
        }
    }
    for (const uid of body.leads) {
        if (users.get(uid)!.data.roles?.lead !== true) {
            throw new RouteError(400, "invalid_lead_role", `User ${uid} does not have the lead role.`);
        }
    }
    for (const uid of body.representatives) {
        if (users.get(uid)!.data.roles?.representative !== true) {
            throw new RouteError(400, "invalid_representative_role", `User ${uid} does not have the representative role.`);
        }
    }
    return users;
}

async function rosterFor(id: string): Promise<UserRow[]> {
    const snapshot = await adminDb.collection("users").where("committees", "array-contains", id).get();
    return snapshot.docs.map((snap) => ({ uid: snap.id, ref: snap.ref, data: snap.data() }));
}

/**
 * The pending join-request docs among `uids`. Enrolling someone directly — a
 * roster add or a leadership assignment — answers their request, so the request
 * doc has to be deleted in the same batch. Otherwise it lingers in the requests
 * tab for a user who is already on the roster, and deciding it later is a
 * decision on a settled membership.
 */
async function pendingRequests(id: string, uids: string[]) {
    const unique = [...new Set(uids)];
    if (!unique.length) return [];
    const snaps = await Promise.all(
        unique.map((uid) => adminDb.doc(`committeeVerification/${id}/requests/${uid}`).get())
    );
    return snaps.filter((snap) => snap.exists);
}

/**
 * The same "approved" push `decideRequest` sends, for members whose pending
 * request a direct enrollment resolved — from their side the request was
 * approved, just not through the requests tab. Never fatal: the batch has
 * already committed, so a failure here comes back as a warning.
 */
async function notifyApproved(c: CommitteeContext, committeeName: string, uids: string[]) {
    if (!uids.length) return undefined;
    const idToken = c.get("idToken");
    const results = await Promise.allSettled(
        uids.map((uid) => sendNotificationCommitteeRequest({ uid, type: "approved", committeeName, idToken }))
    );
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    failed.forEach((result) => console.error("sendNotificationCommitteeRequest(approved) failed:", result.reason));
    if (!failed.length) return undefined;
    return `Pending join ${failed.length === 1 ? "request was" : "requests were"} cleared, but ${failed.length} mobile notification${failed.length === 1 ? "" : "s"} failed to send.`;
}

async function saveCommittee(id: string, body: CommitteeBody, exists: boolean) {
    const leadership = await validateLeadership(body);
    const roster = exists ? await rosterFor(id) : [];
    const rosterUids = new Set(roster.map((user) => user.uid));
    const leadersToEnroll = [...leadership.values()].filter((user) => !rosterUids.has(user.uid));
    const requests = exists ? await pendingRequests(id, leadersToEnroll.map((user) => user.uid)) : [];
    const memberCount = roster.length + leadersToEnroll.length;
    if (leadersToEnroll.length + requests.length + 1 > MAX_ATOMIC_WRITES) {
        throw new RouteError(409, "operation_too_large", "Too many leadership memberships for one atomic operation.");
    }

    const batch = adminDb.batch();
    const { head, ...rest } = body;
    batch.set(adminDb.doc(`committees/${id}`), {
        ...rest,
        ...(head ? { head } : {}),
        memberCount,
    });
    leadersToEnroll.forEach((user) => batch.set(user.ref, { committees: FieldValue.arrayUnion(id) }, { merge: true }));
    requests.forEach((request) => batch.delete(request.ref));
    await batch.commit();
    return { memberCount, requestsResolved: requests.map((request) => request.id) };
}

export const committeesRouter = new Hono<{ Variables: AuthVariables }>();

committeesRouter.post("/", async (c) => {
    try {
        const parsed = committeeBodySchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) throw new RouteError(400, "validation_error", "Invalid request body.", parsed.error.issues);
        const id = committeeSlugFromName(parsed.data.name);
        if (!id) throw new RouteError(400, "invalid_slug", "Committee name must contain letters or numbers.");
        const ref = adminDb.doc(`committees/${id}`);
        if ((await ref.get()).exists) throw new RouteError(409, "committee_exists", `Committee already exists: ${id}.`);
        const { memberCount } = await saveCommittee(id, parsed.data, false);
        return c.json({ id, memberCount }, 201);
    } catch (error) { return errorResponse(c, error); }
});

committeesRouter.put("/:id", async (c) => {
    try {
        const id = c.req.param("id");
        const ref = adminDb.doc(`committees/${id}`);
        const snap = await ref.get();
        if (!snap.exists) throw new RouteError(404, "committee_not_found", `Committee not found: ${id}.`);
        const raw = await c.req.json().catch(() => null);
        const current = canonicalFromStored(id, snap.data() ?? {});
        const parsed = committeeBodySchema.safeParse({ ...current, ...(raw ?? {}) });
        if (!parsed.success) throw new RouteError(400, "validation_error", "Invalid request body.", parsed.error.issues);
        const { memberCount, requestsResolved } = await saveCommittee(id, parsed.data, true);
        const warning = await notifyApproved(c, parsed.data.name, requestsResolved);
        return c.json({ ok: true, memberCount, ...(warning ? { warning } : {}) });
    } catch (error) { return errorResponse(c, error); }
});

committeesRouter.post("/:id/members", async (c) => {
    try {
        const id = c.req.param("id");
        const committeeRef = adminDb.doc(`committees/${id}`);
        const committeeSnap = await committeeRef.get();
        if (!committeeSnap.exists) throw new RouteError(404, "committee_not_found", `Committee not found: ${id}.`);
        const parsed = addMembersSchema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) throw new RouteError(400, "validation_error", "Invalid request body.", parsed.error.issues);
        const [users, roster, requests] = await Promise.all([
            loadUsers(parsed.data.uids),
            rosterFor(id),
            pendingRequests(id, parsed.data.uids),
        ]);
        const newlyAdded = [...users.values()].filter((user) => !(user.data.committees ?? []).includes(id));
        const batch = adminDb.batch();
        newlyAdded.forEach((user) => batch.set(user.ref, { committees: FieldValue.arrayUnion(id) }, { merge: true }));
        requests.forEach((request) => batch.delete(request.ref));
        batch.set(committeeRef, { memberCount: roster.length + newlyAdded.length }, { merge: true });
        await batch.commit();
        const warning = await notifyApproved(c, committeeSnap.get("name") || id, requests.map((request) => request.id));
        return c.json({ ok: true, added: newlyAdded.length, requestsResolved: requests.length, ...(warning ? { warning } : {}) });
    } catch (error) { return errorResponse(c, error); }
});

committeesRouter.delete("/:id/members/:uid", async (c) => {
    try {
        const { id, uid } = c.req.param();
        const committeeRef = adminDb.doc(`committees/${id}`);
        const userRef = adminDb.doc(`users/${uid}`);
        const [committeeSnap, userSnap, roster] = await Promise.all([committeeRef.get(), userRef.get(), rosterFor(id)]);
        if (!committeeSnap.exists) throw new RouteError(404, "committee_not_found", `Committee not found: ${id}.`);
        if (!userSnap.exists) throw new RouteError(404, "user_not_found", `User not found: ${uid}.`);
        const wasMember = (userSnap.get("committees") ?? []).includes(id);
        const raw = committeeSnap.data() ?? {};
        const head = uidFromLegacy(raw.head);
        const leads = uidListFromLegacy(raw.leads).filter((value) => value !== uid);
        const representatives = uidListFromLegacy(raw.representatives).filter((value) => value !== uid);
        const batch = adminDb.batch();
        batch.set(userRef, { committees: FieldValue.arrayRemove(id) }, { merge: true });
        batch.set(committeeRef, {
            ...(head === uid ? { head: FieldValue.delete() } : {}),
            leads,
            representatives,
            memberCount: Math.max(0, roster.length - (wasMember ? 1 : 0)),
        }, { merge: true });
        await batch.commit();
        return c.json({ ok: true, removed: wasMember });
    } catch (error) { return errorResponse(c, error); }
});

async function decideRequest(c: CommitteeContext, type: "approved" | "denied") {
    try {
        const { id, uid } = c.req.param();
        const committeeRef = adminDb.doc(`committees/${id}`);
        const requestRef = adminDb.doc(`committeeVerification/${id}/requests/${uid}`);
        const userRef = adminDb.doc(`users/${uid}`);
        const [committeeSnap, requestSnap, userSnap, roster] = await Promise.all([committeeRef.get(), requestRef.get(), userRef.get(), rosterFor(id)]);
        if (!committeeSnap.exists) throw new RouteError(404, "committee_not_found", `Committee not found: ${id}.`);
        if (!requestSnap.exists) throw new RouteError(404, "request_not_found", `No pending request for ${uid}.`);
        if (!userSnap.exists) throw new RouteError(404, "user_not_found", `User not found: ${uid}.`);
        const wasMember = (userSnap.get("committees") ?? []).includes(id);
        const batch = adminDb.batch();
        if (type === "approved" && !wasMember) {
            batch.set(userRef, { committees: FieldValue.arrayUnion(id) }, { merge: true });
            batch.set(committeeRef, { memberCount: roster.length + 1 }, { merge: true });
        }
        batch.delete(requestRef);
        await batch.commit();

        let warning: string | undefined;
        try {
            await sendNotificationCommitteeRequest({ uid, type, committeeName: committeeSnap.get("name") || id, idToken: c.get("idToken") });
        } catch (error) {
            console.error(`sendNotificationCommitteeRequest(${type}) failed for ${id}/${uid}:`, error);
            warning = `Request ${type}, but the mobile notification failed to send.`;
        }
        return c.json(warning ? { ok: true, warning } : { ok: true });
    } catch (error) { return errorResponse(c, error); }
}

committeesRouter.post("/:id/requests/:uid/approve", (c) => decideRequest(c, "approved"));
committeesRouter.post("/:id/requests/:uid/deny", (c) => decideRequest(c, "denied"));

async function cleanupTargets(id: string) {
    const [users, requests] = await Promise.all([
        rosterFor(id),
        adminDb.collection(`committeeVerification/${id}/requests`).get(),
    ]);
    return { users, requests: requests.docs };
}

committeesRouter.post("/:id/reset", async (c) => {
    try {
        const id = c.req.param("id");
        const committeeRef = adminDb.doc(`committees/${id}`);
        if (!(await committeeRef.get()).exists) throw new RouteError(404, "committee_not_found", `Committee not found: ${id}.`);
        const { users, requests } = await cleanupTargets(id);
        const writes = 1 + users.length + requests.length;
        if (writes > MAX_ATOMIC_WRITES) throw new RouteError(409, "operation_too_large", `Reset requires ${writes} writes; Firestore permits 500 atomically.`);
        const batch = adminDb.batch();
        users.forEach((user) => batch.set(user.ref, { committees: FieldValue.arrayRemove(id) }, { merge: true }));
        requests.forEach((request) => batch.delete(request.ref));
        batch.set(committeeRef, { head: FieldValue.delete(), leads: [], representatives: [], memberCount: 0 }, { merge: true });
        await batch.commit();
        return c.json({ ok: true, membersRemoved: users.length, requestsRemoved: requests.length });
    } catch (error) { return errorResponse(c, error); }
});

committeesRouter.delete("/:id", async (c) => {
    try {
        const id = c.req.param("id");
        const committeeRef = adminDb.doc(`committees/${id}`);
        if (!(await committeeRef.get()).exists) throw new RouteError(404, "committee_not_found", `Committee not found: ${id}.`);
        const events = await adminDb.collection("events").where("committee", "==", id).get();
        const now = Timestamp.now().toMillis();
        const active = events.docs.filter((event) => {
            const endTime = event.get("endTime");
            return !endTime || typeof endTime.toMillis !== "function" || endTime.toMillis() >= now;
        });
        if (active.length) throw new RouteError(409, "committee_has_active_events", "Delete or reassign active committee events first.", { eventIds: active.map((event) => event.id) });
        const { users, requests } = await cleanupTargets(id);
        const writes = 1 + users.length + requests.length;
        if (writes > MAX_ATOMIC_WRITES) throw new RouteError(409, "operation_too_large", `Delete requires ${writes} writes; Firestore permits 500 atomically.`);
        const batch = adminDb.batch();
        users.forEach((user) => batch.set(user.ref, { committees: FieldValue.arrayRemove(id) }, { merge: true }));
        requests.forEach((request) => batch.delete(request.ref));
        batch.delete(committeeRef);
        await batch.commit();
        return c.json({ ok: true, membersRemoved: users.length, requestsRemoved: requests.length });
    } catch (error) { return errorResponse(c, error); }
});
