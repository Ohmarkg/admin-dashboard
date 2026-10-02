/**
 * Scale seed for the Points page (performance work) — emulator only.
 *
 * Run with the emulators up:
 *   bun run scripts/seed-stress.ts            # add the stress data
 *   bun run scripts/seed-stress.ts --clean    # remove it again
 *
 * Adds (all ids prefixed `stress-`, so it never collides with `bun run seed`):
 *  - 1,260 users (300 active this school year, 150 with ONLY last-year logs,
 *    810 with no logs), ~20 of them with no public email + a privateInfo doc
 *  - ~90 events across this school year + ~60 last school year
 *  - dual-located logs (events/{id}/logs/{uid} + users/{uid}/event-logs/{id})
 *  - the hidden "Instagram Points" event, dated LAST school year, with 60
 *    members whose first award was last year and who were awarded again this
 *    year (creationTime old, instagramLogs recent — the collection-group
 *    `creationTime` filter alone would miss these)
 *
 * Deterministic (seeded PRNG) so before/after benchmark runs see identical data.
 */

import "./lib/requireEmulator";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "tamushpemobileapp" });
const db = getFirestore(app);

const TOTAL_USERS = 1260;
const ACTIVE_USERS = 300;
const LAST_YEAR_ONLY_USERS = 150;
const INSTAGRAM_RETURNING_USERS = 60;
const THIS_YEAR_EVENTS = 90;
const LAST_YEAR_EVENTS = 60;
const NO_PUBLIC_EMAIL_USERS = 20;

// --- helpers ---------------------------------------------------------------

let seedState = 20260930;
/** mulberry32 — small deterministic PRNG. */
function rand(): number {
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = seedState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];

const ts = (d: Date) => Timestamp.fromDate(d);

const FIRST = ["Alejandra", "Diego", "Sofia", "Carlos", "Valeria", "Miguel", "Lucia", "Andres", "Isabella", "Mateo", "Camila", "Santiago", "Daniela", "Emilio", "Ximena", "Javier", "Natalia", "Ricardo", "Paula", "Gabriel"];
const LAST = ["Ramirez", "Martinez", "Hernandez", "Gutierrez", "Torres", "Flores", "Morales", "Castillo", "Reyes", "Ortiz", "Mendoza", "Vargas", "Navarro", "Cruz", "Salazar", "Rojas", "Medina", "Aguilar", "Silva", "Delgado"];
const EVENT_TYPES = ["General Meeting", "Workshop", "Volunteer Event", "Social Event", "Committee Meeting", "Study Hours"];

// School year boundaries — same rule as lib/hooks/usePoints.ts (June–May).
const now = new Date();
const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
const thisYearStart = new Date(startYear, 5, 1);
const lastYearStart = new Date(startYear - 1, 5, 1);

const randomDateBetween = (from: Date, to: Date) =>
    new Date(from.getTime() + rand() * (to.getTime() - from.getTime()));

// --- clean -----------------------------------------------------------------

async function clean() {
    console.log("Removing stress data…");
    const bulk = db.bulkWriter();
    for (const coll of ["users", "events"]) {
        const snap = await db
            .collection(coll)
            .where("__name__", ">=", "stress-")
            .where("__name__", "<", "stress.")
            .get();
        for (const d of snap.docs) await db.recursiveDelete(d.ref, bulk);
    }
    await bulk.close();
    console.log("Done.");
}

// --- seed ------------------------------------------------------------------

async function seed() {
    const bulk = db.bulkWriter();
    bulk.onWriteError((err) => {
        console.error("write failed:", err.message);
        return err.failedAttempts < 3;
    });

    // Events
    interface EventRow {
        id: string;
        start: Date;
        end: Date;
        points: number;
    }
    const thisYearEvents: EventRow[] = [];
    const lastYearEvents: EventRow[] = [];

    const makeEvent = (id: string, name: string, start: Date, hidden: boolean): EventRow => {
        const end = new Date(start.getTime() + randInt(1, 3) * 3_600_000);
        const points = hidden ? 1 : pick([1, 2, 3, 3, 5]);
        bulk.set(db.doc(`events/${id}`), {
            id,
            name,
            description: `${name} — stress-test event.`,
            eventType: hidden ? "Custom Event" : pick(EVENT_TYPES),
            tags: [],
            startTime: ts(start),
            endTime: ts(end),
            signInPoints: points,
            signOutPoints: 0,
            pointsPerHour: 0,
            locationName: "Zachry Engineering Center",
            geolocation: null,
            geofencingRadius: 100,
            committee: "",
            creator: "stress-seed",
            general: true,
            hiddenEvent: hidden,
            notificationSent: true,
            nationalConventionEligible: true,
        });
        return { id, start, end, points };
    };

    // This school year: from June 1 up to now (logs only exist for past events).
    for (let i = 0; i < THIS_YEAR_EVENTS; i++) {
        const start = randomDateBetween(thisYearStart, now);
        thisYearEvents.push(makeEvent(`stress-event-ty-${i}`, `Stress Event TY-${i + 1}`, start, false));
    }
    for (let i = 0; i < LAST_YEAR_EVENTS; i++) {
        const start = randomDateBetween(lastYearStart, new Date(thisYearStart.getTime() - 86_400_000));
        lastYearEvents.push(makeEvent(`stress-event-ly-${i}`, `Stress Event LY-${i + 1}`, start, false));
    }

    // Hidden Instagram Points event, dated LAST school year.
    const igStart = randomDateBetween(lastYearStart, new Date(thisYearStart.getTime() - 86_400_000));
    const igEvent = makeEvent("stress-event-instagram", "Instagram Points", igStart, true);

    // Users
    interface UserRow {
        uid: string;
        name: string;
        points: number;
    }
    const users: UserRow[] = [];

    for (let i = 0; i < TOTAL_USERS; i++) {
        const uid = `stress-user-${String(i).padStart(4, "0")}`;
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        let points = 0;

        const category = i < ACTIVE_USERS ? "active" : i < ACTIVE_USERS + LAST_YEAR_ONLY_USERS ? "lastYear" : "none";

        const attend = (events: EventRow[], count: number) => {
            const chosen = new Set<number>();
            while (chosen.size < Math.min(count, events.length)) chosen.add(randInt(0, events.length - 1));
            for (const idx of chosen) {
                const ev = events[idx];
                // Only past events have attendance.
                if (ev.start > now) continue;
                const log = {
                    uid,
                    points: ev.points,
                    signInTime: ts(ev.start),
                    signOutTime: ts(ev.end),
                    creationTime: ts(ev.start),
                    verified: true,
                    instagramLogs: [] as Timestamp[],
                };
                bulk.set(db.doc(`events/${ev.id}/logs/${uid}`), log);
                bulk.set(db.doc(`users/${uid}/event-logs/${ev.id}`), { ...log, eventId: ev.id });
                points += ev.points;
            }
        };

        if (category === "active") {
            attend(thisYearEvents, randInt(8, 30));
            attend(lastYearEvents, randInt(0, 15));
        } else if (category === "lastYear") {
            attend(lastYearEvents, randInt(2, 15));
        }

        users.push({ uid, name, points });
    }

    // Instagram points: first award last year, returning this year — for the
    // first INSTAGRAM_RETURNING_USERS active users — plus 40 other active users
    // awarded only this year.
    for (let i = 0; i < INSTAGRAM_RETURNING_USERS + 40; i++) {
        const user = users[i];
        const returning = i < INSTAGRAM_RETURNING_USERS;
        const awards: Date[] = [];
        if (returning) {
            for (let n = 0; n < randInt(1, 4); n++) {
                awards.push(randomDateBetween(lastYearStart, new Date(thisYearStart.getTime() - 86_400_000)));
            }
        }
        for (let n = 0; n < randInt(1, 6); n++) {
            awards.push(randomDateBetween(thisYearStart, now));
        }
        awards.sort((a, b) => a.getTime() - b.getTime());

        const log = {
            uid: user.uid,
            points: awards.length,
            // creationTime = FIRST award, exactly like the real award flow.
            signInTime: ts(awards[0]),
            signOutTime: ts(awards[0]),
            creationTime: ts(awards[0]),
            verified: true,
            instagramLogs: awards.map(ts),
        };
        bulk.set(db.doc(`events/${igEvent.id}/logs/${user.uid}`), log);
        bulk.set(db.doc(`users/${user.uid}/event-logs/${igEvent.id}`), { ...log, eventId: igEvent.id });
        user.points += awards.length;
    }

    // Rank by points, write user docs.
    const ranked = [...users].sort((a, b) => b.points - a.points);
    ranked.forEach((user, index) => {
        const slug = user.name.toLowerCase().replace(/[^a-z]+/g, ".");
        const email = `${slug}.${user.uid.slice(-4)}@tamu.edu`;
        const missingEmail = Number(user.uid.slice(-4)) >= TOTAL_USERS - NO_PUBLIC_EMAIL_USERS;

        bulk.set(db.doc(`users/${user.uid}`), {
            uid: user.uid,
            ...(missingEmail ? {} : { email }),
            displayName: user.name,
            name: user.name,
            photoURL: "",
            roles: { officer: Number(user.uid.slice(-4)) % 97 === 0 },
            major: "Mechanical Engineering",
            classYear: "2027",
            committees: [],
            pointsRank: index + 1,
            rankChange: "same",
            points: user.points,
            pointsThisMonth: 0,
            isStudent: true,
            isEmailPublic: !missingEmail,
        });
        if (missingEmail) {
            bulk.set(db.doc(`users/${user.uid}/private/privateInfo`), {
                completedAccountSetup: true,
                email,
            });
        }
    });

    await bulk.close();
    console.log(
        `Seeded ${TOTAL_USERS} users (${ACTIVE_USERS} active, ${LAST_YEAR_ONLY_USERS} last-year-only), ` +
            `${THIS_YEAR_EVENTS} + ${LAST_YEAR_EVENTS} events, Instagram event ${igEvent.id} ` +
            `(${INSTAGRAM_RETURNING_USERS} returning members).`
    );
}

if (process.argv.includes("--clean")) {
    await clean();
} else {
    await clean(); // idempotent re-seed
    await seed();
}
process.exit(0);
