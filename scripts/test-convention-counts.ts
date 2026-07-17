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
    deriveConventionCounts,
    isConventionEligible,
    type ConventionCounts,
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

const eventTypeById = new Map<string, string>([
    ["evt-volunteer", EventType.VOLUNTEER_EVENT],
    ["evt-workshop", EventType.WORKSHOP],
    ["evt-general", EventType.GENERAL_MEETING],
    ["evt-social", EventType.SOCIAL_EVENT],
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

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
