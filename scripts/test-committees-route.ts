/** Emulator self-test for committee CRUD, roster, request, reset, and delete routes. */

import "./lib/requireEmulator";
import { Hono } from "hono";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const firebaseApp = getApps().length ? getApps()[0] : initializeApp({ projectId: "tamushpemobileapp" });
const db = getFirestore(firebaseApp);
const { committeesRouter } = await import("../server/routes/committees");
const testApp = new Hono().route("/committees", committeesRouter);

const slug = "route-test-committee";
const userIds = ["route-head", "route-lead", "route-rep", "route-member", "route-applicant", "route-denied", "route-direct", "route-promoted"];
const eventIds = ["route-test-active-event", "route-test-past-event"];
let failures = 0;

function check(condition: unknown, label: string, detail?: unknown) {
    if (condition) console.log(`PASS: ${label}`);
    else {
        failures += 1;
        console.log(`FAIL: ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
    }
}

async function request(method: string, path: string, body?: unknown) {
    const response = await testApp.request(path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
}

async function seedTestData() {
    const roles: Record<string, Record<string, boolean>> = {
        "route-head": { officer: true },
        "route-lead": { lead: true },
        "route-rep": { representative: true },
        "route-promoted": { lead: true },
    };
    await Promise.all(userIds.map((uid) => db.doc(`users/${uid}`).set({ uid, name: uid, email: `${uid}@example.com`, committees: [], roles: roles[uid] ?? {} })));
}

const input = {
    name: "Route Test Committee",
    color: "#500000",
    description: "Route test committee",
    head: "route-head",
    leads: ["route-lead"],
    representatives: ["route-rep"],
    applicationLink: "https://example.com/apply",
    logo: "default",
    isOpen: false,
};

async function runTests() {
    const created = await request("POST", "/committees", input);
    check(created.status === 201 && created.body?.id === slug, "create derives committee slug", JSON.stringify(created));
    const committee = await db.doc(`committees/${slug}`).get();
    check(committee.get("head") === "route-head" && committee.get("memberCount") === 3, "create writes canonical UIDs and enrolls leadership");
    const enrolled = await Promise.all(["route-head", "route-lead", "route-rep"].map((uid) => db.doc(`users/${uid}`).get()));
    check(enrolled.every((snap) => snap.get("committees").includes(slug)), "leadership users are committee members");

    const duplicate = await request("POST", "/committees", input);
    check(duplicate.status === 409, "duplicate slug returns 409");
    const clearedHead = await request("PUT", `/committees/${slug}`, { head: null });
    const headlessDoc = await db.doc(`committees/${slug}`).get();
    check(clearedHead.status === 200 && !headlessDoc.get("head") && (await db.doc("users/route-head").get()).get("committees").includes(slug), "metadata update can clear head without removing membership");
    const badRole = await request("POST", "/committees", { ...input, name: "Bad Role Committee", leads: ["route-member"] });
    check(badRole.status === 400 && badRole.body?.error?.code === "invalid_lead_role", "lead role is enforced");

    const added = await request("POST", `/committees/${slug}/members`, { uids: ["route-member", "route-member"] });
    check(added.status === 200 && added.body?.added === 1, "roster add is deduped");
    const readded = await request("POST", `/committees/${slug}/members`, { uids: ["route-member"] });
    check(readded.body?.added === 0, "roster add is idempotent");

    const removed = await request("DELETE", `/committees/${slug}/members/route-lead`);
    const afterRemove = await db.doc(`committees/${slug}`).get();
    check(removed.status === 200 && !afterRemove.get("leads").includes("route-lead") && afterRemove.get("memberCount") === 3, "removing a member clears leadership and recounts");

    await db.doc(`committeeVerification/${slug}/requests/route-direct`).set({ uploadDate: new Date().toISOString() });
    const directAdd = await request("POST", `/committees/${slug}/members`, { uids: ["route-direct"] });
    const directRequest = await db.doc(`committeeVerification/${slug}/requests/route-direct`).get();
    check(directAdd.status === 200 && directAdd.body?.added === 1 && directAdd.body?.requestsResolved === 1 && !directRequest.exists, "roster add clears the applicant's pending request", JSON.stringify(directAdd.body));

    await db.doc(`committeeVerification/${slug}/requests/route-promoted`).set({ uploadDate: new Date().toISOString() });
    const promoted = await request("PUT", `/committees/${slug}`, { leads: ["route-promoted"] });
    const promotedRequest = await db.doc(`committeeVerification/${slug}/requests/route-promoted`).get();
    check(promoted.status === 200 && (await db.doc("users/route-promoted").get()).get("committees").includes(slug) && !promotedRequest.exists, "leadership assignment clears the applicant's pending request", JSON.stringify(promoted.body));

    await db.doc(`committeeVerification/${slug}/requests/route-applicant`).set({ uploadDate: new Date().toISOString() });
    const approved = await request("POST", `/committees/${slug}/requests/route-applicant/approve`);
    const approvedUser = await db.doc("users/route-applicant").get();
    const approvedRequest = await db.doc(`committeeVerification/${slug}/requests/route-applicant`).get();
    check(approved.status === 200 && approvedUser.get("committees").includes(slug) && !approvedRequest.exists, "request approval enrolls and removes request");

    await db.doc(`committeeVerification/${slug}/requests/route-denied`).set({ uploadDate: new Date().toISOString() });
    const denied = await request("POST", `/committees/${slug}/requests/route-denied/deny`);
    check(denied.status === 200 && !(await db.doc(`committeeVerification/${slug}/requests/route-denied`).get()).exists, "request denial removes request");

    await db.doc(`committeeVerification/${slug}/requests/route-denied`).set({ uploadDate: new Date().toISOString() });
    const reset = await request("POST", `/committees/${slug}/reset`);
    const resetCommittee = await db.doc(`committees/${slug}`).get();
    const resetUsers = await Promise.all(userIds.map((uid) => db.doc(`users/${uid}`).get()));
    check(reset.status === 200 && resetCommittee.get("memberCount") === 0 && !resetCommittee.get("head") && resetCommittee.get("applicationLink") === input.applicationLink, "reset clears leadership/count and preserves metadata");
    check(resetUsers.every((snap) => !(snap.get("committees") ?? []).includes(slug)), "reset removes every member");
    check(!(await db.doc(`committeeVerification/${slug}/requests/route-denied`).get()).exists, "reset clears pending requests");

    await db.doc(`events/${eventIds[0]}`).set({ committee: slug, endTime: Timestamp.fromMillis(Date.now() + 60_000) });
    const blocked = await request("DELETE", `/committees/${slug}`);
    check(blocked.status === 409 && blocked.body?.error?.code === "committee_has_active_events", "active event blocks deletion");
    await db.doc(`events/${eventIds[0]}`).delete();
    await db.doc(`events/${eventIds[1]}`).set({ committee: slug, endTime: Timestamp.fromMillis(Date.now() - 60_000) });
    const deleted = await request("DELETE", `/committees/${slug}`);
    check(deleted.status === 200 && !(await db.doc(`committees/${slug}`).get()).exists, "historical event allows deletion");

    await db.doc("committees/legacy-route-test").set({
        name: "Legacy Route Test", color: "#500000", logo: "default", description: "legacy",
        head: { uid: "route-head", name: "route-head" }, leads: [{ uid: "route-lead" }],
        representatives: [], memberApplicationLink: "https://example.com/legacy", isOpen: false,
    });
    const normalized = await request("PUT", "/committees/legacy-route-test", { description: "normalized" });
    const normalizedDoc = await db.doc("committees/legacy-route-test").get();
    check(normalized.status === 200 && normalizedDoc.get("head") === "route-head" && normalizedDoc.get("applicationLink") === "https://example.com/legacy" && !normalizedDoc.get("memberApplicationLink"), "legacy update writes canonical shape");
}

async function cleanup() {
    await Promise.all([
        ...userIds.map((uid) => db.doc(`users/${uid}`).delete()),
        ...eventIds.map((id) => db.doc(`events/${id}`).delete()),
        db.doc(`committees/${slug}`).delete(),
        db.doc("committees/bad-role-committee").delete(),
        db.doc("committees/legacy-route-test").delete(),
    ]);
}

try {
    await seedTestData();
    await runTests();
} finally {
    await cleanup();
}

console.log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
if (failures) process.exit(1);
