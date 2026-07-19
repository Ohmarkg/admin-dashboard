# TAMU SHPE Admin Web — HTTP API Contract

The server-side HTTP surface, served by **Hono** mounted at `app/api/[[...route]]/route.ts` (the only `route.ts`). This is the contract the client hooks (`lib/hooks/*`) and AI tools should code against. Data shapes referenced here are defined in [DATA_MODEL.md](./DATA_MODEL.md).

> **Status:** design/contract. No routes are implemented yet. Shapes below are the agreed target; adjust here first if they change, then in code.

---

## The boundary: this API is write-only

Per [REBUILD_CONCEPT.md](./REBUILD_CONCEPT.md) §3, **reads stay on the client Firebase SDK** (wrapped in TanStack Query). The Hono API exists only for:

1. **Writes** — anything that mutates Firestore (create/update/approve/deny/points-edit), run under the Admin SDK service account so client write rules can stay locked down.
2. **Privileged actions** — server-only operations that shouldn't be client-triggerable, e.g. Cloud Function invocations that recalculate or notify.

There are **no `GET` data-fetch routes** — none, including Excel export (that generates client-side; see [Points](#server-routespointsts--apipoints)). If you're reaching for a `GET`, the read belongs in a client hook instead (see [§ Client-side reads](#client-side-reads-not-api-routes)).

> Note: [REBUILD_CONCEPT.md](./REBUILD_CONCEPT.md) §4 sketches some `GET` routes in its "example route shapes." Those illustrate what each module's data *is*; in implementation those reads live in client hooks, not here. This file is the authoritative split.

---

## Conventions

- **Base path:** `/api`. Routers are mounted by module: `/api/membership`, `/api/points`, `/api/events`, `/api/tools`, `/api/conventions`, `/api/instagram`.
- **Runtime:** `export const runtime = 'nodejs'` in the mount (Admin SDK requires it).
- **Auth:** every route passes through the auth middleware ([`server/middleware/auth.ts`](../server/middleware/auth.ts)). It verifies the Firebase **ID token** (from the `Authorization: Bearer <token>` header) and requires **any** recognized custom claim (`admin`/`officer`/`developer`/`lead`/`representative`). Binary gate — no per-route roles (see [REBUILD_CONCEPT.md](./REBUILD_CONCEPT.md) §4). Missing/invalid token → `401`; valid token without a recognized claim → `403`.
- **Request bodies:** JSON, validated with **zod** at the top of each handler. Validation failure → `400` with the zod issues.
- **Responses:** JSON. Success → `200` (or `201` for create) with the resource or `{ ok: true }`. 
- **Error shape (standardize):**
  ```jsonc
  { "error": { "code": "string_slug", "message": "human readable" } }
  ```
  Status codes: `400` validation, `401` unauthenticated, `403` unauthorized, `404` not found, `409` conflict, `500` server/Firestore error.
- **Timestamps (decided):** `Timestamp` fields in request/response bodies are serialized as **`{ seconds: number, nanoseconds: number }`** — Firestore-native, round-trips to a `Timestamp` on both ends, and the existing `isMemberVerified`/`formatExpirationDate` helpers already accept this shape. Validate with zod `{ seconds, nanoseconds }` and convert to an Admin-SDK `Timestamp` in the route. (This only matters for event create/update bodies — reads go through the client SDK and get native `Timestamp` objects, no serialization involved.)
- **Same-origin:** called only from this app's frontend — no CORS config needed.

---

## Routes

Legend — **Writes**: Firestore docs mutated (all within one atomic batch per request). **CF**: Cloud Function invoked.

> **Cloud Function invocation (X3, decided):** `updateAllUserPoints` and `sendNotificationMemberSHPE` are deployed **v1 callable** functions in the shared Firebase project (MobileApp repo, default region `us-central1`). Routes invoke them over the callable HTTP protocol (`POST {origin}/{name}` with `{ data }`), forwarding the **calling officer's own Firebase ID token** as the Bearer credential — equivalent to mobile's `httpsCallable`, so the functions' own claim checks authorize the same account (`server/lib/cloudFunctions.ts`; origin overridable via `CLOUD_FUNCTIONS_ORIGIN`). On the emulator these remain no-op dev stubs. Caveat: the functions accept `admin/officer/developer/secretary/representative` claims but **not `lead`** — a lead-only web user gets `permission-denied` from the CF (same as on mobile) even though the dashboard itself admits them. CF failures never roll back the already-committed Firestore batch: membership routes return `ok: true` with a `warning`; `/points/recalculate` returns a structured `502 cloud_function_error`.

### `server/routes/membership.ts` — `/api/membership`

| Method | Path | Body | Writes / CF | Notes |
|---|---|---|---|---|
| POST | `/:uid/approve` | optional `{ nationalExpiration?: {seconds, nanoseconds} }` (reads request server-side) | `users/{uid}` set `chapterExpiration` + `nationalExpiration` (from `memberSHPE/{uid}`, with the body's `nationalExpiration` overriding the request's value when provided); delete `memberSHPE/{uid}`. CF: `sendNotificationMemberSHPE({uid, type:'approved'})` | User-doc update + request delete must be one atomic batch; fire the notification after commit succeeds. The override is parity with mobile `MemberSHPEConfirm` "Adjust Date"; `chapterExpiration` is intentionally **not** overridable (mobile offers no such adjustment) |
| POST | `/:uid/deny` | none | `users/{uid}` clear `chapterExpiration` + `nationalExpiration`; delete `memberSHPE/{uid}`. CF: `sendNotificationMemberSHPE({uid, type:'denied'})` | Same atomicity note |

### `server/routes/points.ts` — `/api/points`

| Method | Path | Body | Writes / CF | Notes |
|---|---|---|---|---|
| POST | `/edit` | `{ edits: [{ eventId: string, uid: string, points: number \| null }] }` | For each edit, dual-write `events/{eventId}/logs/{uid}` + `users/{uid}/event-logs/{eventId}`, both `edited:true, verified:true`; backfill `creationTime`/`signInTime` from event `startTime`, and — whenever `signInTime` is backfilled — `signOutTime` from event `endTime` (falls back to `startTime`) so backfilled attendance satisfies the convention tracker's both-times rule. Logs with a real `signInTime` but no `signOutTime` are left untouched. **All edits in one atomic batch.** | **Decided: batch, not single-cell** — the spreadsheet saves many cells at once and the original `updatePointsInFirebase` already takes an array. A single edit is just a one-element array. The reference vertical slice ([REBUILD_CONCEPT.md](./REBUILD_CONCEPT.md) §10) |
| POST | `/recalculate` | none | CF: `updateAllUserPoints` | Recomputes aggregate `points`/`pointsThisMonth` on user docs. Client calls this after `/edit` succeeds |

> **Firestore batch limit:** a batch caps at **500 writes**, and each edit is 2 writes (dual-write), so **≤250 edits per batch**. If a save exceeds that, chunk into sequential batches server-side and only report success if all commit. The per-edit `startTime` lookups are reads (not batched) — cache them per `eventId` within the request to avoid N duplicate `getDoc`s.

> **Excel export — decided: client-side, no route.** Generated in the browser with ExcelJS + file-saver (as in the original), from the points data already read client-side. A server route would only re-fetch data the officer already has, for no security gain.

### `server/routes/events.ts` — `/api/events`

| Method | Path | Body | Writes / CF | Notes |
|---|---|---|---|---|
| POST | `/` | `SHPEEvent` (subtype-shaped) | create `events/{eventId}` | Fixes original bug: create only `console.log`'d, never persisted |
| PUT | `/:id` | partial `SHPEEvent` | update `events/{id}` | |
| POST | `/:id/logs/:uid/approve` | none | set `verified:true` on `events/{id}/logs/{uid}` **and** `users/{uid}/event-logs/{id}` | Dual-write batch, mirrors points pattern |
| POST | `/:id/logs/bulk-approve` | `{ uids: string[] }` | set `verified:true` for each uid across both log paths, one batch | New feature — was missing entirely |

> **Cover images:** the event create/edit UI uploads the image file to Storage at `events/cover-images/{uid}{now}` via the **client** Storage SDK (same path convention and flow as mobile's `SetGeneralEventDetails`) and sends the resulting download URL as `coverImageURI` in the route body. The Firestore write still goes through the route; only the file upload is client-side. `nationalConventionEligible` is likewise settable from create/edit — it is event metadata read by mobile; the web Convention Tracker intentionally does **not** use it (see Convention tracker note below).

### `server/routes/tools.ts` — `/api/tools`

| Method | Path | Body | Writes / CF | Notes |
|---|---|---|---|---|
| POST | `/shirts/:uid/toggle` | `{ shirtPickedUp: boolean }` | update `shirt-sizes/{uid}.shirtPickedUp` | **Decided: Hono route.** It's a Firestore write, so it must go server-side — leaving it client-side would require client write access to `shirt-sizes`, reopening the write surface the rebuild closes |

> **Resume-zip trigger — decided: stays a client `httpsCallable('zipResume')`, NOT a Hono route.** It is *not* a Firestore write from the client — it invokes a Cloud Function that writes `resumes/status`/`resumes/data` under its own service account and must authorize its own callers anyway (the mobile app can call it too). Routing it through the Admin SDK (which has no `httpsCallable`) would add plumbing for zero security gain. This is the one deliberate client-side mutation-trigger exception; the `resumes/*` reads are already client `onSnapshot`. If strict "every action through Hono" uniformity is ever wanted, wrap it as `POST /tools/resume-zip` calling the function's HTTPS endpoint.

### `server/routes/conventions.ts` — `/api/conventions`

| Method | Path | Body | Writes / CF | Notes |
|---|---|---|---|---|
| POST | `/track` | `{ uids: string[] }` (1–500, deduped server-side) | create `convention-tracking/{uid}` (`{ dateAdded, addedBy }`) for each uid not already tracked, one batch | **Idempotent adds:** already-tracked uids are skipped (original `dateAdded`/`addedBy` preserved) and reported in `alreadyTracked`; uids with no `users/{uid}` doc are skipped and reported in `unknownUids` (non-fatal — the CSV import surfaces them). Response: `{ ok: true, tracked, alreadyTracked, unknownUids }` |
| POST | `/:uid/untrack` | none | delete `convention-tracking/{uid}` | Always `200 { ok: true }`, even if not tracked — deliberate divergence from the shirt-toggle 404; remove-twice is harmless and a 404 would only surface a spurious error after a race |

> Eligibility counts are **never written** — they are derived client-side at read time from `users/{uid}/event-logs` joined to `events/{eventId}.eventType` (see [DATA_MODEL.md](./DATA_MODEL.md) § convention-tracking).

> **Eligibility rule vs `nationalConventionEligible` (decided, issue #6):** the tracker's eligibility is **type-based** — a log counts when it has both `signInTime` and `signOutTime` and its event's `eventType` is Volunteer Event / Workshop / General Meeting (≥ 2 attendances in each category). The per-event `nationalConventionEligible` flag (settable from mobile and from web event create/edit) is **event metadata for the mobile app and is intentionally ignored here** — it marks what an event *is*, not what a member *attended*, and no mobile eligibility computation consumes it either. This is stated in the tracker UI and in the event form's helper copy so officers don't assume the flag drives eligibility. Revisit only if the chapter adopts a flag-based eligibility policy; that would be a product change to `deriveConventionCounts`, not a bug fix.

### `server/routes/instagram.ts` — `/api/instagram`

| Method | Path | Body | Writes / CF | Notes |
|---|---|---|---|---|
| POST | `/award` | `{ uids: string[] }` (1–200, deduped server-side) | for each uid: increment `points` by the event's `signInPoints` and append `Timestamp.now()` to `instagramLogs`, merge-set to BOTH `events/{eventId}/logs/{uid}` and `users/{uid}/event-logs/{eventId}`, one atomic batch | Ports the mobile `addInstagramPoints` callable (Wear It Wednesday). The hidden "Instagram Points" event is resolved by an **idempotent transactional get-or-create** (issue #8): the by-name query and the conditional create commit atomically, so concurrent first-awards can't each create an event, and if duplicate docs already exist (mobile's non-transactional path can race) the lexicographically-smallest doc id is always selected — awards never silently split across duplicates. Created with the mobile app's exact field set. Full-doc merge sets (no `arrayUnion`/`increment`) to stay byte-compatible with the callable. uids with no `users/{uid}` doc are skipped and reported. Response: `{ ok: true, eventId, awarded, unknownUids, pointsPerAward }`. The 200-uid cap keeps the dual-write ≤400 ops = one atomic batch |

### `committees`
No routes — committees are **read-only** in this app (client hook, [§ below](#client-side-reads-not-api-routes)). Add a router only if committee editing is introduced.

---

## Client-side reads (NOT API routes)

For reference, so nobody adds these as endpoints. These live in `lib/hooks/*` using the client Firebase SDK + TanStack Query (`useQuery`), or `onSnapshot` for live data. Maps to the original `app/api/firebaseUtils.ts` helpers.

| Data | Source helper (original) | Query key (suggested) |
|---|---|---|
| Event roster / calendar | `getEvents` | `['events']` |
| Event logs (per event) | `getEventLogs(eventId)` | `['events', eventId, 'logs']` |
| Pending events (unverified logs) | derived from `getEvents` + `getEventLogs` | `['events', 'pending']` |
| Members / roster (+ private + logs) | `getMembers` | `['members']` |
| Membership requests | `getMembersToVerify` | `['membership', 'requests']` |
| Official members | filter `getMembers` by `isMemberVerified` | `['membership', 'official']` |
| Committees | `getCommittees` | `['committees']` |
| Shirt list | `getShirtsToVerify` (+ `getMembers`) | `['shirts']` |
| Points spreadsheet (total + monthly) | `getMembers` + logs, assembled client-side | `['points']` |
| Resume-zip status / data | `onSnapshot('resumes/status')`, `onSnapshot('resumes/data')` | raw listener (outside TanStack Query) |
| Convention tracking roster + derived counts | new (`convention-tracking` + per-user `event-logs` + `events` type join) | `['conventions']` |
| Instagram points history | new (`events` by name "Instagram Points" + `events/{id}/logs` joined to `users/{uid}`) | `['instagram-points']` |

**Mutation → invalidation:** each write hook calls `queryClient.invalidateQueries()` on the relevant key(s) on success, replacing the original's manual reload buttons. E.g. a points edit invalidates `['points']` and `['members']`; approve/deny invalidates `['membership', ...]` and `['members']`.

---

## Resolved decisions

These were open; now settled (rationale in the route notes above):

- **Excel export** → client-side, no route. Data is already read client-side; ExcelJS in the browser.
- **Points edit granularity** → batch endpoint `POST /points/edit` with `{ edits: [...] }`, one atomic batch (≤250 edits/batch, chunk beyond).
- **Shirt toggle** → Hono route (it's a Firestore write). **Resume-zip trigger** → stays client `httpsCallable` (not a client Firestore write; function self-authorizes).
- **Timestamp serialization** → `{ seconds, nanoseconds }` in bodies (see Conventions).

## Still open

_(nothing — the last item below was settled during the build)_

- **Batch commit failure semantics** (settled): chunks commit **sequentially and fail fast** — on a chunk error no further chunks are attempted, and the error reports which chunk failed and how many writes had already been applied (`ChunkedBatchError` in `server/lib/db-helpers.ts`: `failedChunkIndex`, `batchesCommitted`, `writesApplied`). Cross-chunk atomicity is deliberately deferred until real save sizes approach the 250-edit (500-write) cap.
