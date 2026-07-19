/**
 * Self-test for the convention-attendance derivation logic in
 * lib/hooks/useConventionTracker.ts. Pure functions, no Firebase — run with
 * `bun run scripts/test-convention-counts.ts` (no emulator required).
 *
 * Verifies:
 *  - a log missing signOutTime is excluded
 *  - a log missing signInTime is excluded
 *  - a log whose event type is Social Event (not a tracked category) is excluded
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
    startTime: Timestamp | null = now
): ConventionEventInfo {
    return { eventType, name, startTime };
}

const eventTypeById = new Map<string, ConventionEventInfo>([
    ["evt-volunteer", eventInfo(EventType.VOLUNTEER_EVENT, "Park Cleanup")],
    ["evt-workshop", eventInfo(EventType.WORKSHOP, "Resume Workshop")],
    ["evt-general", eventInfo(EventType.GENERAL_MEETING, "GM 1")],
    ["evt-social", eventInfo(EventType.SOCIAL_EVENT, "Tailgate")],
]);

// 1. Missing signOutTime -> excluded.
{
    const counts = deriveConventionCounts(
        [log({ signOutTime: undefined })],
        eventTypeById
    );
    assertCounts("log missing signOutTime -> excluded", counts, {
        volunteer: 0,
        workshop: 0,
        generalMeeting: 0,
    });
}

// 2. Missing signInTime -> excluded.
{
    const counts = deriveConventionCounts(
        [log({ signInTime: undefined })],
        eventTypeById
    );
    assertCounts("log missing signInTime -> excluded", counts, {
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

// 7. Attendance lists carry event details and match the counts (issue #14).
{
    const logs = [
        log({ eventId: "evt-volunteer" }),
        log({ eventId: "evt-workshop" }),
        log({ eventId: "evt-workshop", signOutTime: undefined }), // excluded
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
