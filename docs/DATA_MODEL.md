# TAMU SHPE Admin Web — Data Model & Type Contract

**Source of truth for the shape of Firestore data and the `app/types/` definitions.**

This app shares the Firestore database `tamushpemobileapp` with the chapter mobile app. Types in `app/types/` are **manually mirrored** from `MobileApp/src/types/*` — they are not a shared package. Any schema change must be applied in both repos *and* reflected here.

- All timestamps are Firestore `Timestamp` (seconds + nanoseconds), not JS `Date` or numbers.
- Firestore documents are schemaless; the "optional?" column reflects the TypeScript type and observed usage, not an enforced constraint. Treat almost every field as possibly-absent when reading.
- On the wire (Hono JSON responses), `Timestamp` is serialized — settle the serialization convention in [API.md](./API.md) (recommended: `{ seconds, nanoseconds }` or ISO string, applied consistently).

---

## Collection map

| Path | Doc ID | Type | Mirrors (mobile) |
|---|---|---|---|
| `users/{uid}` | Firebase Auth UID | `PublicUserInfo` | `User.ts` |
| `users/{uid}/private/privateInfo` | fixed `privateInfo` | `PrivateUserInfo` | `User.ts` |
| `users/{uid}/private/moderationData` | fixed `moderationData` | `UserModerationData` | `User.ts` |
| `users/{uid}/event-logs/{eventId}` | event ID | `SHPEEventLog` | `Events.ts` |
| `events/{eventId}` | auto ID | `SHPEEvent` (+ subtype) | `Events.ts` |
| `events/{eventId}/logs/{userId}` | user UID | `SHPEEventLog` | `Events.ts` |
| `memberSHPE/{uid}` | user UID | membership request (see below) | `membership.ts` |
| `shirt-sizes/{uid}` | user UID | shirt submission (see below) | — |
| `committees/{id}` | slug (e.g. `technical-affairs`) | `Committee` | `Committees.ts` |
| `resumes/status` | fixed `status` | `{ isGenerated }` | — |
| `resumes/data` | fixed `data` | `{ url, createdAt, expiresAt }` | — |
| `convention-tracking/{uid}` | user UID | roster doc (see below) | — (admin-web-only) |

Defined in [`app/types/`](../app/types/): [`user.ts`](../app/types/user.ts), [`events.ts`](../app/types/events.ts), [`membership.ts`](../app/types/membership.ts), [`committees.ts`](../app/types/committees.ts).

---

## `users/{uid}` — `PublicUserInfo`

Public member profile, readable by any authenticated app user. Ordered by `points desc` in the roster.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Doc ID; set in code from `doc.id`, not always stored on the doc |
| `email` | string | |
| `displayName` | string | |
| `photoURL` | string | |
| `resumePublicURL` | string | |
| `roles` | `Roles` | **Display only — does NOT control Firebase permissions** (see below) |
| `name` | string | |
| `bio` | string | |
| `major` | string | See `MAJORS` in [user.ts](../app/types/user.ts) |
| `classYear` | string | |
| `committees` | string[] | Committee slugs |
| `pointsRank` | number | |
| `rankChange` | `"decreased" \| "same" \| "increased"` | |
| `nationalExpiration` | Timestamp | Set on membership **approve**; cleared on **deny**. Drives `isMemberVerified` |
| `chapterExpiration` | Timestamp | Same as above |
| `resumeVerified` | boolean | |
| `interests` | string[] | |
| `points` | number | Aggregate total; recalculated by `updateAllUserPoints` |
| `pointsThisMonth` | number | |
| `isStudent` | boolean | |
| `isEmailPublic` | boolean | |

### `Roles`
`reader`, `officer`, `admin`, `developer`, `representative`, `lead`, `secretary` (all optional booleans) + `customTitle?: string`.

> **Roles vs. access.** `PublicUserInfo.roles` is **UI display only** (badge colors, role labels) and does not gate anything in this app. Admin-site access is gated entirely by **Firebase Auth custom claims** (checked in [`app/helpers/auth.ts`](../app/helpers/auth.ts) and, in the rebuild, the Hono auth middleware). Do not conflate the two.

## `users/{uid}/private/privateInfo` — `PrivateUserInfo`

Sensitive; scoped to the owning user in the mobile app. **The admin app reads this client-side** (see boundary note in [REBUILD_CONCEPT.md](./REBUILD_CONCEPT.md) §3), so read rules must permit officer access.

| Field | Type |
|---|---|
| `completedAccountSetup` | boolean |
| `settings` | `AppSettings` = `{ darkMode: boolean }` |
| `expoPushTokens` | string[] |
| `expirationDate` | Timestamp |
| `resumeURL` | string |
| `email` | string |

## `users/{uid}/private/moderationData` — `UserModerationData`
`{ canUseKnockOnWall?: boolean }`. Present in the type; not currently used by the admin app.

---

## `events/{eventId}` — `SHPEEvent`

Abstract base with concrete subtypes selected by `eventType`. All fields optional/nullable on the base class.

**Core fields:** `id`, `name`, `description`, `eventType` (`EventType`), `tags[]`, `startTime`, `endTime`, `startTimeBuffer` (ms), `endTimeBuffer` (ms), `coverImageURI`, `locationName`, `geolocation` (`GeoPoint`), `geofencingRadius` (m), `committee`, `creator`, `general`, `hiddenEvent`, `notificationSent`, `nationalConventionEligible`.

**Point fields:** `signInPoints`, `signOutPoints`, `pointsPerHour`. **Workshop-only:** `workshopType` (`"Professional" | "Academic" | "None"`).

### `EventType` (enum → stored string value)
`General Meeting`, `Committee Meeting`, `Study Hours`, `Workshop`, `Volunteer Event`, `Social Event`, `Intramural Event`, `Custom Event`.

Subtype template classes (`GeneralMeeting`, `CommitteeMeeting`, `StudyHours`, `Workshop`, `VolunteerEvent`, `SocialEvent`, `IntramuralEvent`, `CustomEvent`) set sensible field defaults and which point fields apply. See [events.ts](../app/types/events.ts). Note: Study Hours only awards points if the user signed both in and out.

## `SHPEEventLog` — used in **two** places (dual-write)

Canonical at `events/{eventId}/logs/{userId}`; mirrored at `users/{uid}/event-logs/{eventId}`.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | |
| `points` | number | |
| `eventId` | string | Populated in the user-mirror copy |
| `signInTime` | Timestamp | |
| `signOutTime` | Timestamp | |
| `creationTime` | Timestamp | |
| `verified` | boolean | Officer approval flag |
| `instagramLogs` | Timestamp[] | Instagram-points logging — one entry appended per Wear-It-Wednesday award. Logs live under the hidden event named `"Instagram Points"` (`hiddenEvent: true`, `signInPoints: 1`), which is looked up by name and lazily created — by the mobile app client-side, or by `POST /api/instagram/award` server-side — whichever awards first |
| `edited` | boolean | Officer-edited flag, set alongside `verified: true` on points edits. **Declared as `edited?: boolean` in [`SHPEEventLog`](../app/types/events.ts)** (gap closed during the rebuild types port); the matching `MobileApp/src/types/Events.ts` change is carried over by hand in the mobile repo. Original write site: firebaseUtils.ts:151. |

---

## `memberSHPE/{uid}` — membership request

A pending membership verification submission. No dedicated stored-shape interface; the admin app reads it into `RequestWithDoc` ([membership.ts](../app/types/membership.ts)).

**Stored fields:** `chapterURL`, `nationalURL`, `chapterExpiration` (Timestamp), `nationalExpiration` (Timestamp), `shirtSize` (string).
**Derived in `RequestWithDoc` (not stored on this doc):** `uid` (= doc ID), `name` (looked up from `users/{uid}.name`).

> **Request validity rule:** a doc counts as a real request only if **both** `chapterURL` and `nationalURL` are non-empty (see `getMembersToVerify`, firebaseUtils.ts:102).

## `shirt-sizes/{uid}` — shirt submission
`{ shirtSize: string, shirtUploadDate: Timestamp, shirtPickedUp: boolean }`. `uid` is the doc ID. Officers toggle `shirtPickedUp`.

## `committees/{id}` — `Committee`
`name`, `firebaseDocName` (= doc ID), `color`, `logo` (key into `committeeLogos`), `description`, `head` (`PublicUserInfo`), `leads` (`PublicUserInfo[]`), `memberCount`, `memberApplicationLink`, `leadApplicationLink`. Read-only in this app. `head`/`leads` wiring was partially stubbed in the original; the rebuild's `useCommittees()` hook reads both shapes (embedded `PublicUserInfo` and bare-uid fallback with a `users/{uid}` lookup).

## `convention-tracking/{uid}` — National Convention roster

Roster of members an officer is tracking for National Convention eligibility (Tools → Convention Tracker). `uid` is the doc ID (Firebase Auth UID).

| Field | Type | Notes |
|---|---|---|
| `dateAdded` | Timestamp | Set server-side when tracked; preserved on idempotent re-adds |
| `addedBy` | string | UID of the officer who tracked the member (from the ID token) |

**Counts and eligibility are never stored.** They are derived at read time in `lib/hooks/useConventionTracker.ts`: a log at `users/{uid}/event-logs/{eventId}` counts toward a category iff it has **both `signInTime` and `signOutTime`** and the event's `eventType` is `Volunteer Event`, `Workshop`, or `General Meeting`; eligible = all three counts ≥ 2. (`signInTime` alone is unreliable — the points editor backfills it, invariant 1.) The event's `nationalConventionEligible` flag is **not** consulted (v1 decision). Resetting for a new convention cycle = deleting the roster docs; no migration needed.

> **Admin-web-only collection** — the mobile app never reads or writes it, so there is **no mobile type mirror** (deliberate exception to the type-sync checklist below). Its TS interface lives in `lib/hooks/useConventionTracker.ts`, not `app/types/`.

## `resumes/status` & `resumes/data`
Job status for the resume-zip Cloud Function, consumed via real-time `onSnapshot`:
- `resumes/status` → `{ isGenerated: boolean }`
- `resumes/data` → `{ url: string, createdAt: Timestamp, expiresAt: Timestamp }`

---

## Invariants & business rules

1. **Dual-write (points).** Editing points writes the same record to `events/{eventId}/logs/{userId}` **and** `users/{uid}/event-logs/{eventId}` in a single atomic `writeBatch`. Both get `edited: true, verified: true`; `creationTime`/`signInTime` are backfilled from the event's `startTime` if missing. Original impl: `updatePointsInFirebase`; the rebuild's canonical impl is `server/routes/points.ts` (`POST /api/points/edit`, chunked ≤250 edits per atomic batch).
2. **Membership verified** (`isMemberVerified`, [membership.ts:18](../app/types/membership.ts#L18)): true only when **both** `nationalExpiration` and `chapterExpiration` exist and are ≥ now.
3. **Approve** sets `users/{uid}` `chapterExpiration`/`nationalExpiration` from the request, deletes `memberSHPE/{uid}`, and calls `sendNotificationMemberSHPE({ uid, type: 'approved' })`. **Deny** clears both expirations (`deleteField`), deletes `memberSHPE/{uid}`, notifies `'denied'`. ⚠️ In the original these are separate un-batched writes; the rebuild should make the user-doc update + request delete atomic in the Hono route.
4. **Aggregate points** on `users/{uid}` (`points`, `pointsThisMonth`) are derived — never hand-edit them; recalculated by the `updateAllUserPoints` Cloud Function after log edits.
5. **Points school year** runs June–May (drives the monthly-matrix view).

## Cloud Functions (external to this repo)

| Function | Args | Purpose |
|---|---|---|
| `updateAllUserPoints` | none | Recalculate aggregate point totals on user docs |
| `sendNotificationMemberSHPE` | `{ uid, type: 'approved' \| 'denied' }` | Push notification to member's mobile app |
| `zipResume` | none | Bundle member resumes into a downloadable zip; writes `resumes/status` + `resumes/data` |

> The Admin SDK has no `httpsCallable`. When these are invoked from a Hono route, see [REBUILD_CONCEPT.md](./REBUILD_CONCEPT.md) §4 ("Invoking Cloud Functions from the server").

## Type-sync checklist (do this on any schema change)

- [ ] Update the interface in `app/types/*` **and** the matching `MobileApp/src/types/*`.
- [ ] Update the affected table in this doc.
- [ ] Update request/response shapes in [API.md](./API.md) if a route exposes the field.
- [x] ~~Known open gap: `SHPEEventLog.edited`~~ — closed on the web side (declared in `app/types/events.ts`); mobile-repo mirror (`MobileApp/src/types/Events.ts`) carried over by hand — confirm there on next mobile release.
