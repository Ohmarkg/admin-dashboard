/**
 * Self-test for the school-year month bucketing logic in lib/hooks/usePoints.ts
 * (BUILD_PLAN V4 acceptance criteria). Pure functions, no Firebase — run with
 * `bun run scripts/test-points-bucketing.ts` (no emulator required).
 *
 * Verifies (DATA_MODEL invariant 5 — school year runs June-May):
 *  - June of the school-year start year -> index 0
 *  - May of the following year -> index 11
 *  - a handful of months in between map to the expected index
 *  - dates outside the current school year (either side) are excluded (null)
 */

import {
    getCurrentSchoolYearMonths,
    getSchoolYearLabel,
    schoolYearMonthIndex,
} from "../lib/hooks/usePoints";

let failures = 0;

function pass(label: string) {
    console.log(`PASS: ${label}`);
}

function fail(label: string, detail?: unknown) {
    failures += 1;
    console.log(`FAIL: ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}

function assertIndex(label: string, date: Date, now: Date, expected: number | null) {
    const got = schoolYearMonthIndex(date, now);
    if (got === expected) {
        pass(label);
    } else {
        fail(label, `expected ${expected}, got ${got}`);
    }
}

// Anchor "now" to a fixed date so the test is deterministic regardless of
// when it's run: March 15, 2026 -> current school year is June 2025-May 2026.
const now = new Date(2026, 2, 15);

assertIndex("June (school-year start) -> index 0", new Date(2025, 5, 1), now, 0);
assertIndex("June, mid-month -> index 0", new Date(2025, 5, 20), now, 0);
assertIndex("July -> index 1", new Date(2025, 6, 4), now, 1);
assertIndex("December -> index 6", new Date(2025, 11, 25), now, 6);
assertIndex("January (following year) -> index 7", new Date(2026, 0, 2), now, 7);
assertIndex("May (following year, school-year end) -> index 11", new Date(2026, 4, 31), now, 11);

// Outside the current school year (both directions) -> excluded.
assertIndex("May of the PRIOR school year -> null (excluded)", new Date(2025, 4, 31), now, null);
assertIndex("June of the NEXT school year -> null (excluded)", new Date(2026, 5, 1), now, null);
assertIndex("Far future date -> null (excluded)", new Date(2030, 0, 1), now, null);

// getCurrentSchoolYearMonths / getSchoolYearLabel sanity.
const months = getCurrentSchoolYearMonths(now);
if (
    months.length === 12 &&
    months[0].getFullYear() === 2025 &&
    months[0].getMonth() === 5 &&
    months[11].getFullYear() === 2026 &&
    months[11].getMonth() === 4
) {
    pass("getCurrentSchoolYearMonths -> 12 months, June 2025..May 2026");
} else {
    fail("getCurrentSchoolYearMonths -> 12 months, June 2025..May 2026", JSON.stringify(months));
}

const label = getSchoolYearLabel(now);
if (label === "2025-2026") {
    pass('getSchoolYearLabel -> "2025-2026"');
} else {
    fail('getSchoolYearLabel -> "2025-2026"', label);
}

// Cross-check: every month in getCurrentSchoolYearMonths() maps back to its
// own index via schoolYearMonthIndex.
let roundTripOk = true;
months.forEach((date, index) => {
    if (schoolYearMonthIndex(date, now) !== index) {
        roundTripOk = false;
    }
});
if (roundTripOk) {
    pass("every getCurrentSchoolYearMonths() entry round-trips through schoolYearMonthIndex");
} else {
    fail("every getCurrentSchoolYearMonths() entry round-trips through schoolYearMonthIndex");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
