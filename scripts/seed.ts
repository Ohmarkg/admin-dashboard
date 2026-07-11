/**
 * Emulator seed script (BUILD_PLAN S7 / testing baseline).
 *
 * Run with the emulators up: `bun run seed`
 * Admin SDK, no credentials — points at the Emulator Suite only. Aborts if the
 * emulator env vars are missing so it can never touch production.
 *
 * Creates:
 *  - 1 test officer Auth account (custom claim `officer`) + officer user doc
 *  - 8 member users with `private/privateInfo`
 *  - 6 events across 3 months with verified AND unverified logs, dual-located
 *    (events/{id}/logs/{uid} + users/{uid}/event-logs/{id} — mirror pattern)
 *  - 2 valid memberSHPE requests (both proof URLs) + 1 invalid (missing one)
 *  - shirt-sizes docs
 *  - 3 committees with heads/leads
 *  - resumes/status + resumes/data
 */

process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "localhost:9099";

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";

const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "tamushpemobileapp" });
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------------------------------------------------------------------

const OFFICER = {
    uid: "officer-test",
    email: "shpe-officer@tamu.edu",
    password: "testpassword",
    name: "SHPE Officer (shared)",
};

const MEMBERS = [
    { uid: "member-01", name: "Alejandra Ramirez", major: "Mechanical Engineering", classYear: "2027" },
    { uid: "member-02", name: "Diego Martinez", major: "Computer Science", classYear: "2026" },
    { uid: "member-03", name: "Sofia Hernandez", major: "Civil Engineering", classYear: "2028" },
    { uid: "member-04", name: "Carlos Gutierrez", major: "Electrical Engineering", classYear: "2027" },
    { uid: "member-05", name: "Valeria Torres", major: "Industrial & Systems Engineering", classYear: "2026" },
    { uid: "member-06", name: "Miguel Flores", major: "Aerospace Engineering", classYear: "2029" },
    { uid: "member-07", name: "Lucia Morales", major: "Chemical Engineering", classYear: "2027" },
    { uid: "member-08", name: "Andres Castillo", major: "Computer Engineering", classYear: "2028" },
];

const SHIRT_SIZES = ["S", "M", "L", "XL", "M", "L", "S", "XXL"];

function ts(d: Date): Timestamp {
    return Timestamp.fromDate(d);
}

/** startOfMonth(now) shifted by `monthOffset`, at the given day/hour. */
function monthDate(monthOffset: number, day: number, hour: number): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, day, hour, 0, 0);
}

const inAYear = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d;
};

// Events across 3 different months (>= 2 required by the testing baseline).
const EVENTS = [
    {
        id: "event-general-01",
        name: "General Meeting #1",
        eventType: "General Meeting",
        start: monthDate(-2, 5, 18),
        durationHrs: 2,
        signInPoints: 3,
        signOutPoints: 0,
        pointsPerHour: 0,
        committee: "",
    },
    {
        id: "event-workshop-01",
        name: "Resume Workshop",
        eventType: "Workshop",
        start: monthDate(-2, 19, 17),
        durationHrs: 2,
        signInPoints: 3,
        signOutPoints: 0,
        pointsPerHour: 0,
        committee: "professional-development",
        workshopType: "Professional",
    },
    {
        id: "event-study-01",
        name: "Study Hours Week 3",
        eventType: "Study Hours",
        start: monthDate(-1, 8, 16),
        durationHrs: 4,
        signInPoints: 0,
        signOutPoints: 0,
        pointsPerHour: 1,
        committee: "scholastic",
    },
    {
        id: "event-social-01",
        name: "Fall Social",
        eventType: "Social Event",
        start: monthDate(-1, 22, 19),
        durationHrs: 3,
        signInPoints: 2,
        signOutPoints: 0,
        pointsPerHour: 0,
        committee: "",
    },
    {
        id: "event-committee-01",
        name: "Technical Affairs Meeting",
        eventType: "Committee Meeting",
        start: monthDate(0, 3, 18),
        durationHrs: 1,
        signInPoints: 2,
        signOutPoints: 0,
        pointsPerHour: 0,
        committee: "technical-affairs",
    },
    {
        id: "event-volunteer-01",
        name: "Park Cleanup",
        eventType: "Volunteer Event",
        start: monthDate(0, 9, 9),
        durationHrs: 3,
        signInPoints: 4,
        signOutPoints: 2,
        pointsPerHour: 0,
        committee: "",
    },
];

// eventId -> [uid, points, verified][]
const LOGS: Record<string, Array<[string, number, boolean]>> = {
    "event-general-01": [
        ["member-01", 3, true],
        ["member-02", 3, true],
        ["member-03", 3, true],
        ["member-04", 3, true],
        ["member-05", 3, true],
    ],
    "event-workshop-01": [
        ["member-01", 3, true],
        ["member-02", 3, false],
        ["member-06", 3, true],
    ],
    "event-study-01": [
        ["member-02", 4, true],
        ["member-03", 2, false],
        ["member-07", 3, true],
    ],
    "event-social-01": [
        ["member-01", 2, true],
        ["member-04", 2, false],
        ["member-05", 2, true],
        ["member-08", 2, true],
    ],
    "event-committee-01": [
        ["member-03", 2, true],
        ["member-06", 2, false],
    ],
    "event-volunteer-01": [
        ["member-01", 6, true],
        ["member-05", 6, false],
        ["member-07", 6, false],
    ],
};

const COMMITTEES = [
    {
        id: "technical-affairs",
        name: "Technical Affairs",
        color: "#500000",
        logo: "TechnicalAffairs",
        description: "Hands-on technical projects and competitions for members.",
        headUid: "member-02",
        leadUids: ["member-04", "member-08"],
        memberCount: 24,
    },
    {
        id: "professional-development",
        name: "Professional Development",
        color: "#1F6F8B",
        logo: "ProfessionalDevelopment",
        description: "Resume reviews, mock interviews, and corporate connections.",
        headUid: "member-05",
        leadUids: ["member-01"],
        memberCount: 31,
    },
    {
        id: "scholastic",
        name: "Scholastic",
        color: "#B98A00",
        logo: "Scholastic",
        description: "Study hours, tutoring, and academic resources.",
        headUid: "member-03",
        leadUids: ["member-07"],
        memberCount: 18,
    },
];

// ---------------------------------------------------------------------------

async function ensureAuthUser(opts: {
    uid: string;
    email: string;
    password?: string;
    displayName: string;
    claims?: Record<string, boolean>;
}) {
    try {
        await auth.createUser({
            uid: opts.uid,
            email: opts.email,
            password: opts.password ?? "testpassword",
            displayName: opts.displayName,
            emailVerified: true,
        });
    } catch (err: unknown) {
        if ((err as { code?: string }).code !== "auth/uid-already-exists") throw err;
    }
    if (opts.claims) await auth.setCustomUserClaims(opts.uid, opts.claims);
}

async function main() {
    console.log(`Seeding emulators (firestore=${process.env.FIRESTORE_EMULATOR_HOST}, auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST})`);

    // --- Officer (binary auth gate is exercised through this account) ---
    await ensureAuthUser({
        uid: OFFICER.uid,
        email: OFFICER.email,
        password: OFFICER.password,
        displayName: OFFICER.name,
        claims: { officer: true },
    });
    await db.doc(`users/${OFFICER.uid}`).set({
        uid: OFFICER.uid,
        email: OFFICER.email,
        displayName: OFFICER.name,
        name: OFFICER.name,
        photoURL: "",
        roles: { officer: true },
        points: 0,
        pointsThisMonth: 0,
        major: "Computer Science",
        classYear: "2026",
        committees: [],
        isStudent: true,
        isEmailPublic: false,
    });

    // --- Per-user aggregate points from the logs (invariant 4: derived) ---
    const totals: Record<string, number> = {};
    const monthTotals: Record<string, number> = {};
    const thisMonth = new Date().getMonth();
    for (const ev of EVENTS) {
        for (const [uid, points] of LOGS[ev.id] ?? []) {
            totals[uid] = (totals[uid] ?? 0) + points;
            if (ev.start.getMonth() === thisMonth) {
                monthTotals[uid] = (monthTotals[uid] ?? 0) + points;
            }
        }
    }

    // --- Members: auth users (no claims), user docs, privateInfo ---
    for (const [i, m] of MEMBERS.entries()) {
        const email = `${m.name.toLowerCase().replace(/[^a-z]+/g, ".")}@tamu.edu`;
        await ensureAuthUser({ uid: m.uid, email, displayName: m.name });

        // member-01/02 are verified members; member-03 has expired membership.
        const verifiedMember = i < 2;
        const expired = i === 2;
        const expiration = verifiedMember ? ts(inAYear()) : expired ? ts(monthDate(-3, 1, 0)) : undefined;

        await db.doc(`users/${m.uid}`).set({
            uid: m.uid,
            email,
            displayName: m.name,
            name: m.name,
            photoURL: "",
            roles: {},
            bio: `${m.major} student and active SHPE member.`,
            major: m.major,
            classYear: m.classYear,
            committees: COMMITTEES.filter((c) => c.headUid === m.uid || c.leadUids.includes(m.uid)).map((c) => c.id),
            pointsRank: i + 1,
            rankChange: "same",
            ...(expiration ? { chapterExpiration: expiration, nationalExpiration: expiration } : {}),
            resumeVerified: i % 2 === 0,
            interests: [],
            points: totals[m.uid] ?? 0,
            pointsThisMonth: monthTotals[m.uid] ?? 0,
            isStudent: true,
            isEmailPublic: true,
        });

        await db.doc(`users/${m.uid}/private/privateInfo`).set({
            completedAccountSetup: true,
            settings: { darkMode: false },
            expoPushTokens: [`ExponentPushToken[seed-${m.uid}]`],
            resumeURL: `http://localhost:9199/v0/b/tamushpemobileapp.appspot.com/o/user-docs%2F${m.uid}%2Fresume.pdf?alt=media`,
            email,
        });
    }

    // --- Events + dual-located logs ---
    for (const ev of EVENTS) {
        const start = ts(ev.start);
        const end = ts(new Date(ev.start.getTime() + ev.durationHrs * 3_600_000));
        await db.doc(`events/${ev.id}`).set({
            id: ev.id,
            name: ev.name,
            description: `${ev.name} — seeded event for emulator testing.`,
            eventType: ev.eventType,
            tags: [],
            startTime: start,
            endTime: end,
            startTimeBuffer: 1_200_000,
            endTimeBuffer: 1_200_000,
            coverImageURI: "",
            signInPoints: ev.signInPoints,
            signOutPoints: ev.signOutPoints,
            pointsPerHour: ev.pointsPerHour,
            locationName: "Zachry Engineering Center",
            geolocation: null,
            geofencingRadius: 100,
            committee: ev.committee,
            creator: OFFICER.uid,
            general: ev.committee === "",
            hiddenEvent: false,
            notificationSent: true,
            nationalConventionEligible: true,
            ...(ev.workshopType ? { workshopType: ev.workshopType } : {}),
        });

        for (const [uid, points, verified] of LOGS[ev.id] ?? []) {
            const log = {
                uid,
                points,
                signInTime: start,
                signOutTime: end,
                creationTime: start,
                verified,
                instagramLogs: [],
            };
            // Mirror pattern (DATA_MODEL invariant 1): canonical + user-centric copy.
            await db.doc(`events/${ev.id}/logs/${uid}`).set(log);
            await db.doc(`users/${uid}/event-logs/${ev.id}`).set({ ...log, eventId: ev.id });
        }
    }

    // --- memberSHPE requests: 2 valid + 1 invalid (missing nationalURL) ---
    const proofURL = (uid: string, kind: string) =>
        `http://localhost:9199/v0/b/tamushpemobileapp.appspot.com/o/user-docs%2F${uid}%2F${kind}-proof.png?alt=media`;
    for (const uid of ["member-07", "member-08"]) {
        await db.doc(`memberSHPE/${uid}`).set({
            chapterURL: proofURL(uid, "chapter"),
            nationalURL: proofURL(uid, "national"),
            chapterExpiration: ts(inAYear()),
            nationalExpiration: ts(inAYear()),
            shirtSize: "M",
        });
    }
    await db.doc(`memberSHPE/member-06`).set({
        chapterURL: proofURL("member-06", "chapter"),
        nationalURL: "", // invalid — validity rule requires BOTH URLs non-empty
        chapterExpiration: ts(inAYear()),
        nationalExpiration: ts(inAYear()),
        shirtSize: "L",
    });

    // --- shirt-sizes ---
    for (const [i, m] of MEMBERS.entries()) {
        await db.doc(`shirt-sizes/${m.uid}`).set({
            shirtSize: SHIRT_SIZES[i],
            shirtUploadDate: ts(monthDate(-1, 1 + i, 12)),
            shirtPickedUp: i % 3 === 0,
        });
    }

    // --- committees ---
    const publicSnapshot = async (uid: string) => (await db.doc(`users/${uid}`).get()).data() ?? { uid };
    for (const c of COMMITTEES) {
        await db.doc(`committees/${c.id}`).set({
            name: c.name,
            firebaseDocName: c.id,
            color: c.color,
            logo: c.logo,
            description: c.description,
            head: await publicSnapshot(c.headUid),
            leads: await Promise.all(c.leadUids.map(publicSnapshot)),
            memberCount: c.memberCount,
            memberApplicationLink: "https://example.com/apply",
            leadApplicationLink: "https://example.com/lead-apply",
            isOpen: true,
        });
    }

    // --- resumes (zip job status docs) ---
    await db.doc("resumes/status").set({ isGenerated: false });
    await db.doc("resumes/data").set({
        url: "",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: ts(monthDate(0, 28, 0)),
    });

    console.log("Seed complete:");
    console.log(`  officer login: ${OFFICER.email} / ${OFFICER.password} (claim: officer)`);
    console.log(`  ${MEMBERS.length} members, ${EVENTS.length} events, 3 memberSHPE requests, ${COMMITTEES.length} committees`);
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error("Seed failed:", err);
        process.exit(1);
    }
);
