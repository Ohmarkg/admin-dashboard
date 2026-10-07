/**
 * Self-test for the convention-attendance derivation logic in
 * lib/hooks/useConventionTracker.ts. Pure functions, no Firebase — run with
 * `bun run scripts/test-convention-counts.ts` (no emulator required).
 *
 * Verifies:
 *  - Volunteer Event missing signOutTime still counts (sign-in only)
 *  - Workshop with only signIn or only signOut still counts, flagged incomplete
 *    (a complete workshop is not flagged)
 *  - General Meeting missing signOutTime is excluded
 *  - a Volunteer / General Meeting log missing signInTime is excluded; a log
 *    with neither time is excluded everywhere
 *  - a log whose event type is Social Event (not a tracked category) is excluded
 *  - an event not flagged nationalConventionEligible is excluded in every
 *    category; a flagged event of an untracked type (Social) is still excluded
 *  - a log with an unknown eventId (not in the eventTypeById map) is excluded
 *  - 2 volunteer + 2 workshop + 2 general meeting logs (all both-timestamps)
 *    -> counts {2,2,2}, eligible true
 *  - counts {2,2,1} -> eligible false
 */

import { Timestamp } from "firebase/firestore";
import {
    deriveConventionAttendance,
    deriveConventionCounts,
    isConventionEligible,
    resolveConventionEligibility,
    type ConventionCounts,
    type ConventionEventInfo,
} from "../lib/hooks/useConventionTracker";
import { EventType, type SHPEEventLog } from "../app/types/events";

let failures = 0;

function pass(label: string) {
    console.log(`PASS: ${label}`);
}

function fail(label: string, detail?: unknown) {
    failures += 1;
    console.log(`FAIL: ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}

function assertCounts(label: string, got: ConventionCounts, expected: ConventionCounts) {
    if (
        got.volunteer === expected.volunteer &&
        got.workshop === expected.workshop &&
        got.generalMeeting === expected.generalMeeting
    ) {
        pass(label);
    } else {
        fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
}

const now = Timestamp.fromDate(new Date(2026, 2, 15));

function log(overrides: Partial<SHPEEventLog>): SHPEEventLog {
    return {
        signInTime: now,
        signOutTime: now,
        eventId: "evt-volunteer",
        ...overrides,
    };
}

function eventInfo(
    eventType: string,
    name: string,
    startTime: Timestamp | null = now,
    nationalConventionEligible = true
): ConventionEventInfo {
    return { eventType, name, startTime, nationalConventionEligible };
}

const eventTypeById = new Map<string, ConventionEventInfo>([
    ["evt-volunteer", eventInfo(EventType.VOLUNTEER_EVENT, "Park Cleanup")],
    ["evt-workshop", eventInfo(EventType.WORKSHOP, "Resume Workshop")],
    ["evt-general", eventInfo(EventType.GENERAL_MEETING, "GM 1")],
    ["evt-social", eventInfo(EventType.SOCIAL_EVENT, "Tailgate")],
    ["evt-unflagged", eventInfo(EventType.WORKSHOP, "Unflagged Workshop", now, false)],
    ["evt-unflagged-vol", eventInfo(EventType.VOLUNTEER_EVENT, "Unflagged Cleanup", now, false)],
    ["evt-flagged-social", eventInfo(EventType.SOCIAL_EVENT, "Flagged Social", now, true)],
]);

// 1. Volunteer Event missing signOutTime -> still counts (sign-in only).
{
    const counts = deriveConventionCounts(
        [log({ signOutTime: undefined })],
        eventTypeById
    );
    assertCounts("Volunteer Event missing signOutTime -> counts", counts, {
        volunteer: 1,
        workshop: 0,
        generalMeeting: 0,
    });
}

// 1b. Workshop with only one of sign-in / sign-out -> counts, flagged incomplete.
{
    const cases: [string, Partial<SHPEEventLog>][] = [
        ["sign-in only", { signOutTime: undefined }],
        ["sign-out only", { signInTime: undefined }],
    ];
    for (const [label, overrides] of cases) {
        const logs = [log({ eventId: "evt-workshop", ...overrides })];
        const counts = deriveConventionCounts(logs, eventTypeById);
        assertCounts(`Workshop ${label} -> counts`, counts, {
            volunteer: 0,
            workshop: 1,
            generalMeeting: 0,
        });
        const entry = deriveConventionAttendance(logs, eventTypeById).workshop[0];
        if (entry?.incomplete === true) {
            pass(`Workshop ${label} -> flagged incomplete`);
        } else {
            fail(`Workshop ${label} -> flagged incomplete`, JSON.stringify(entry));
        }
    }

    const full = deriveConventionAttendance(
        [log({ eventId: "evt-workshop" })],
        eventTypeById
    ).workshop[0];
    if (full?.incomplete === false) {
        pass("Workshop with sign-in and sign-out -> not flagged");
    } else {
        fail("Workshop with sign-in and sign-out -> not flagged", JSON.stringify(full));
    }

    const others = deriveConventionAttendance(
        [log({ eventId: "evt-volunteer", signOutTime: undefined })],
        eventTypeById
    ).volunteer[0];
    if (others?.incomplete === false) {
        pass("Volunteer sign-in only -> not flagged");
    } else {
        fail("Volunteer sign-in only -> not flagged", JSON.stringify(others));
    }
}

// 1c. General Meeting missing signOutTime -> excluded.
{
    const counts = deriveConventionCounts(
        [log({ eventId: "evt-general", signOutTime: undefined })],
        eventTypeById
    );
    assertCounts("General Meeting missing signOutTime -> excluded", counts, {
        volunteer: 0,
        workshop: 0,
        generalMeeting: 0,
    });
}

// 2. Missing signInTime -> excluded (Volunteer / General Meeting); no times -> excluded everywhere.
{
    const counts = deriveConventionCounts(
        [
            log({ signInTime: undefined }),
            log({ eventId: "evt-general", signInTime: undefined }),
            log({ eventId: "evt-workshop", signInTime: undefined, signOutTime: undefined }),
        ],
        eventTypeById
    );
    assertCounts("log missing signInTime / both times -> excluded", counts, {
        volunteer: 0,
        workshop: 0,
        generalMeeting: 0,
    });
}

// 3. Event type is Social Event -> excluded.
{
    const counts = deriveConventionCounts(
        [log({ eventId: "evt-social" })],
        eventTypeById
    );
    assertCounts("Social Event log -> excluded", counts, {
        volunteer: 0,
        workshop: 0,
        generalMeeting: 0,
    });
}

// 3b. Events not flagged nationalConventionEligible -> excluded; a flagged
// event of an untracked type still doesn't count.
{
    const counts = deriveConventionCounts(
        [
            log({ eventId: "evt-unflagged" }),
            log({ eventId: "evt-unflagged-vol" }),
            log({ eventId: "evt-flagged-social" }),
        ],
        eventTypeById
    );
    assertCounts("unflagged / untracked-type events -> excluded", counts, {
        volunteer: 0,
        workshop: 0,
        generalMeeting: 0,
    });
}

// 4. Unknown eventId (not in map) -> excluded.
{
    const counts = deriveConventionCounts(
        [log({ eventId: "evt-unknown" })],
        eventTypeById
    );
    assertCounts("unknown eventId -> excluded", counts, {
        volunteer: 0,
        workshop: 0,
        generalMeeting: 0,
    });
}

// 5. 2 volunteer + 2 workshop + 2 general (all both-timestamps) -> {2,2,2}, eligible true.
{
    const logs: SHPEEventLog[] = [
        log({ eventId: "evt-volunteer" }),
        log({ eventId: "evt-volunteer" }),
        log({ eventId: "evt-workshop" }),
        log({ eventId: "evt-workshop" }),
        log({ eventId: "evt-general" }),
        log({ eventId: "evt-general" }),
    ];
    const counts = deriveConventionCounts(logs, eventTypeById);
    assertCounts("2+2+2 both-timestamp logs -> {2,2,2}", counts, {
        volunteer: 2,
        workshop: 2,
        generalMeeting: 2,
    });

    if (isConventionEligible(counts)) {
        pass("counts {2,2,2} -> eligible true");
    } else {
        fail("counts {2,2,2} -> eligible true");
    }
}

// 6. Counts {2,2,1} -> eligible false.
{
    const counts: ConventionCounts = { volunteer: 2, workshop: 2, generalMeeting: 1 };
    if (!isConventionEligible(counts)) {
        pass("counts {2,2,1} -> eligible false");
    } else {
        fail("counts {2,2,1} -> eligible false");
    }
}

// 6b. Officer overrides affect only final status, never the source counts.
{
    const incompleteCounts: ConventionCounts = {
        volunteer: 1,
        workshop: 0,
        generalMeeting: 1,
    };
    const completeCounts: ConventionCounts = {
        volunteer: 2,
        workshop: 3,
        generalMeeting: 2,
    };

    if (
        resolveConventionEligibility(incompleteCounts, true) === true &&
        resolveConventionEligibility(completeCounts, false) === false &&
        resolveConventionEligibility(incompleteCounts, null) === false &&
        resolveConventionEligibility(completeCounts, null) === true
    ) {
        pass("eligibility override wins; null uses calculated eligibility");
    } else {
        fail("eligibility override wins; null uses calculated eligibility");
    }

    assertCounts("eligibility override leaves counts unchanged", incompleteCounts, {
        volunteer: 1,
        workshop: 0,
        generalMeeting: 1,
    });
}

// 7. Attendance lists carry event details and match the counts (issue #14).
{
    const logs = [
        log({ eventId: "evt-volunteer" }),
        log({ eventId: "evt-workshop" }),
        log({ eventId: "evt-workshop", signOutTime: undefined }), // workshop: counts (sign-in or sign-out), flagged
        log({ eventId: "evt-volunteer", signOutTime: undefined }), // volunteer: counts (sign-in only)
        log({ eventId: "evt-social" }), // excluded (untracked category)
    ];
    const attendance = deriveConventionAttendance(logs, eventTypeById);
    const counts = deriveConventionCounts(logs, eventTypeById);

    if (
        attendance.volunteer.length === counts.volunteer &&
        attendance.workshop.length === counts.workshop &&
        attendance.generalMeeting.length === counts.generalMeeting
    ) {
        pass("attendance list lengths match derived counts");
    } else {
        fail(
            "attendance list lengths match derived counts",
            JSON.stringify({ attendance, counts })
        );
    }

    const v = attendance.volunteer[0];
    if (v && v.eventId === "evt-volunteer" && v.name === "Park Cleanup" && v.startTime === now) {
        pass("attendance entry carries eventId/name/startTime");
    } else {
        fail("attendance entry carries eventId/name/startTime", JSON.stringify(v));
    }
}

// 8. Attendance entries sort by startTime ascending, unknown dates last.
{
    const early = Timestamp.fromDate(new Date(2026, 0, 10));
    const late = Timestamp.fromDate(new Date(2026, 4, 10));
    const events = new Map<string, ConventionEventInfo>([
        ["evt-late", eventInfo(EventType.WORKSHOP, "Late Workshop", late)],
        ["evt-early", eventInfo(EventType.WORKSHOP, "Early Workshop", early)],
        ["evt-undated", eventInfo(EventType.WORKSHOP, "Undated Workshop", null)],
    ]);
    const attendance = deriveConventionAttendance(
        [
            log({ eventId: "evt-undated" }),
            log({ eventId: "evt-late" }),
            log({ eventId: "evt-early" }),
        ],
        events
    );
    const names = attendance.workshop.map((e) => e.name);
    if (
        JSON.stringify(names) ===
        JSON.stringify(["Early Workshop", "Late Workshop", "Undated Workshop"])
    ) {
        pass("attendance sorts by startTime ascending, unknown dates last");
    } else {
        fail("attendance sorts by startTime ascending, unknown dates last", JSON.stringify(names));
    }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
