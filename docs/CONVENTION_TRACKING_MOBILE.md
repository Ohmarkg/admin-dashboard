# National Convention — member attendance view (mobile handoff)

Paste-ready context for implementing a **member-facing** convention progress screen in the SHPE mobile app. Officers manage the roster on admin web; this screen only shows a selected member **what they have attended** toward eligibility.

**UI reference:** [`docs/assets/convention-tracker-mobile-reference.png`](./assets/convention-tracker-mobile-reference.png) (“My Requirements” layout — adapt titles/labels to convention, keep the progress + categorized list pattern).

**Canonical derivation (do not reinvent):** admin-dashboard `lib/hooks/useConventionTracker.ts` — port `deriveConventionAttendance`, `deriveConventionCounts`, `isConventionEligible`, `REQUIRED_COUNT`.

---

## Goal

A screen a member opens when they are **on the convention roster** that answers:

1. How close am I to eligible? (overall `X/6`)
2. What have I already attended in each category?
3. How many more do I need in each category?

It is **read-only**. No track/untrack, no points edits, no writing eligibility.

---

## Gate: only show if selected

Officers add members via admin Tools → Convention Tracker, which creates:

```
convention-tracking/{uid}  →  { dateAdded: Timestamp, addedBy: string }
```

- If `getDoc(convention-tracking/{authUid})` **exists** → show this screen (or a nav entry to it).
- If **missing** → hide the feature / show “You’re not on the convention roster.”

> Historically this collection was admin-web-only. Member read of **own** doc is a new consumer — update Firestore rules so `request.auth.uid == uid` can read `convention-tracking/{uid}`; members must not write it. Officers continue to write via admin Hono (`POST /api/conventions/track`, `POST /api/conventions/:uid/untrack`).

---

## Data to load (same Firebase project)

| Path | Use |
|---|---|
| `convention-tracking/{uid}` | Selection gate + optional `dateAdded` |
| `users/{uid}/event-logs/{eventId}` | Attendance logs (`signInTime`, `signOutTime`, `eventId`) |
| `events/{eventId}` | `eventType`, `name`, `startTime`, `nationalConventionEligible` for each log |

**Only events with `nationalConventionEligible === true` count**, in addition to the type mapping below. Admin and mobile use the same rule.

---

## Eligibility rule (must match admin)

`REQUIRED_COUNT = 2` per category. Eligible when all three categories are ≥ 2.

| UI section label | `eventType` value | Log counts when |
|---|---|---|
| Volunteering | `"Volunteer Event"` | `signInTime` present (sign-out **not** required) |
| Workshops | `"Workshop"` | `signInTime` **and** `signOutTime` |
| General Meetings | `"General Meeting"` | `signInTime` **and** `signOutTime` |

Ignore events not flagged `nationalConventionEligible` and all other event types. Sort attended events in each category by `startTime` ascending (unknown last).

Pseudo (matches admin):

```ts
if (!log.signInTime) continue;
const category = CATEGORY_BY_EVENT_TYPE[event.eventType]; // volunteer | workshop | generalMeeting
if (!event.nationalConventionEligible || !category) continue;
if (category !== "volunteer" && !log.signOutTime) continue;
// push { eventId, name, startTime }
```

Counts = lengths of those lists. `eligible = counts every category >= 2`.

---

## Map reference UI → convention data

Reference screen is a generic “My Requirements” mock. Bind it as follows:

### Overall ring + bar

Treat **6 slots** as the denominator: 3 categories × `REQUIRED_COUNT`.

```ts
const met =
  Math.min(counts.volunteer, REQUIRED_COUNT) +
  Math.min(counts.workshop, REQUIRED_COUNT) +
  Math.min(counts.generalMeeting, REQUIRED_COUNT);
// ring shows `${met}/6`, label e.g. "REQUIREMENTS MET"
// "X completed" / "Y remaining" where Y = 6 - met
```

Extra attendances beyond 2 in a category do **not** inflate the ring past that category’s 2 (still list them under the section if you want transparency; officer table allows `3/2`).

Suggested title: **“Convention Progress”** or **“My Convention”** (not “My Requirements”).

### Category sections (3 only)

| Section header | Fraction | Source list |
|---|---|---|
| Volunteering | `min(n,2)/2` or show raw `n/2` like admin | `attendance.volunteer` |
| Workshops | same | `attendance.workshop` |
| General Meetings | same | `attendance.generalMeeting` |

When `count >= 2`, show the green category check next to the fraction (like “General Meetings 2/2” in the reference).

### Row model per category

For each category, build up to `max(REQUIRED_COUNT, attended.length)` rows — or simpler UX:

1. **One row per attended qualifying event** (completed state):
   - Green check
   - Event `name` (strikethrough / muted OK)
   - Date pill from `startTime` (e.g. `Aug 7th`)
2. **Empty incomplete slots** for remaining need:
   - `remaining = max(0, REQUIRED_COUNT - attended.length)`
   - Empty circle + blank/placeholder line (as in the reference)

Example: 1 workshop attended → 1 completed row + 1 empty slot under Workshops.

If `attended.length > REQUIRED_COUNT`, list all attended events; fraction can show `3/2` or clamp display to `2/2` with extras still listed — pick one and stay consistent; admin shows uncapped `n/2`.

---

## Suggested view-model shape

```ts
type ConventionAttendedEvent = {
  eventId: string;
  name: string | null;
  startTime: Timestamp | null; // format for date pill
};

type CategoryProgress = {
  key: "volunteer" | "workshop" | "generalMeeting";
  label: string; // "Volunteering" | "Workshops" | "General Meetings"
  events: ConventionAttendedEvent[];
  count: number;
  required: 2;
  complete: boolean; // count >= 2
  remainingSlots: number; // max(0, 2 - count)
};

type MemberConventionProgress = {
  selected: boolean;
  dateAdded?: Timestamp;
  categories: CategoryProgress[];
  met: number;       // 0..6
  total: 6;
  eligible: boolean;
};
```

Build `categories` from `deriveConventionAttendance` + counts. No Firestore write of this object.

---

## What mobile must NOT do

- Write or delete `convention-tracking/*`
- Store derived counts/eligibility on the user doc
- Count events that are not flagged `nationalConventionEligible`
- Invent different thresholds or event-type buckets than admin
- Call admin Hono convention routes from the member app

---

## Admin sources (same repo)

| Concern | Location |
|---|---|
| Pure derivation | `lib/hooks/useConventionTracker.ts` |
| Roster writes | `server/routes/conventions.ts` |
| Officer UI | `app/(main)/tools/convention-tracker/page.tsx` |
| Schema | `docs/DATA_MODEL.md` § `convention-tracking` |
| API | `docs/API.md` § conventions |
| Compatibility note | `docs/MOBILE_COMPATIBILITY_AUDIT.md` § 3.8 |

---

## Acceptance checklist for the mobile agent

- [ ] Screen only reachable / meaningful when `convention-tracking/{uid}` exists
- [ ] Loads own `event-logs` + related `events`; derives attendance client-side
- [ ] Volunteer = sign-in only; Workshop / GM = sign-in + sign-out
- [ ] Three sections, target 2 each; overall progress over 6 slots
- [ ] Completed rows show event name + date; remaining need shown as empty slots
- [ ] Eligible when all three categories ≥ 2 (same as officer “Eligible” badge)
- [ ] No writes; UI matches the reference’s progress + categorized list pattern
