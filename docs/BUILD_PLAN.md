# TAMU SHPE Admin Web — Build Plan

**Status:** execution roadmap, derived from the settled design docs. Decisions live in
[REBUILD_CONCEPT.md](./REBUILD_CONCEPT.md), [API.md](./API.md), [DATA_MODEL.md](./DATA_MODEL.md),
[PURPOSE_AND_FUNCTIONALITY.md](./PURPOSE_AND_FUNCTIONALITY.md), and [DESIGN_BRIEF.md](./DESIGN_BRIEF.md) —
this file only orders the work. If this plan and a design doc disagree, the design doc wins; fix this file.

**How to use:** tasks carry IDs (`S*` setup, `F*` foundation, `V*` vertical slice, module tracks
`M/E/C/T/P`, `D*` dashboard, `X*` cutover). Each task lists target files, the governing contract,
dependencies, and acceptance criteria verifiable against the Firebase Emulator Suite with seeded data.
Tasks marked **∥** are safe to run concurrently with anything that doesn't depend on them. Everything
through Phase 5 runs **only** on the Emulator Suite — no real credentials until Phase 6
(REBUILD_CONCEPT §9).

**Reference sources:**
- `OLD-tamu-shpe-admin-web/` — the legacy app, kept **only** for referencing old code/behavior when
  needed. Never copy its architecture (client-side writes); do port its data-shape logic where noted.
- `prototype/SHPE Admin Portal.dc.html` (+ `support.js`) — working static HTML prototype of the
  portal. **The structure and design reference for all UI tasks** (DESIGN_BRIEF = intent, prototype =
  realization).

## Phase graph

```
Phase 0 (S: scaffolding — sequential, done directly, not delegated)
  └─► Phase 1 (F: auth foundation ∥ design system)
        └─► Phase 2 (V: points vertical slice — sequential, gates everything after)
              └─► Phase 3 (fan-out, 5 parallel tracks: M membership · E events · C committees · T tools · P points-extras)
                    └─► Phase 4 (D: dashboard — needs real hooks/data from Phase 3)
                          └─► Phase 5 (H: hardening + doc sync)
                                └─► Phase 6 (X: credential cutover / go-live — deliberately last)
```

## Testing baseline (applies to every acceptance criterion)

- `docker compose up` = emulators (Auth 9099 / Firestore 8080 / Storage 9199 / Emulator UI 4000) +
  `bun run dev` on 3000.
- Seed data (S7) provides: 1 test officer account (custom claim `officer`), ~8 member users with
  `private/privateInfo`, ~6 events across ≥2 months including verified **and** unverified logs
  (dual-located per the mirror pattern), ≥2 valid `memberSHPE` requests (both proof URLs present) +
  1 invalid request (missing a URL), `shirt-sizes` docs, ≥3 committees with heads/leads, `resumes/*` docs.
- API tests mint an ID token from the Auth emulator REST API for the seeded officer — that is the
  `Authorization: Bearer` header for `curl` checks.
- Cloud Functions are **not** emulated (separate repo — REBUILD_CONCEPT §9.2): `updateAllUserPoints`
  and `sendNotificationMemberSHPE` go through a server dev stub (log + canned success) gated on the
  emulator env; `zipResume` stays a client callable behind a client dev stub (API.md tools note).

---

## Phase 0 — Scaffolding (S) — done directly by the orchestrator, sequential

Prerequisite setup: nothing else compiles or runs without it. Not delegated.

- **S1 — Project init (bun + Next 14).** Root `package.json` created with bun; deps: `next@14`,
  `react@18`, `typescript`, `tailwindcss`, `hono`, `@tanstack/react-query`, `firebase`,
  `firebase-admin`, `zod`, `date-fns`, `exceljs`, `file-saver`, shadcn toolchain (`tailwind-merge`,
  `class-variance-authority`, `lucide-react`, radix as pulled in by shadcn). `bun.lock` committed; no
  `yarn.lock`. (REBUILD_CONCEPT §10 step 0)
- **S2 — tsconfig.** Paths `@/*`→`./app/*`, `@/server/*`→`./server/*`, `@/lib/*`→`./lib/*`;
  `target: es2017`. (REBUILD_CONCEPT §2)
- **S3 — Directory skeleton + Hono mount.** `app/` (root `layout.tsx`, login `page.tsx` placeholder,
  `(main)/layout.tsx` placeholder), `server/` (`app.ts` with an empty Hono app), `lib/`, and the
  **only** `route.ts`: `app/api/[[...route]]/route.ts` with `export const runtime = 'nodejs'`.
  (REBUILD_CONCEPT §4, §6; CLAUDE.md rule 3)
- **S4 — Types port.** Copy `OLD-tamu-shpe-admin-web/app/types/*` → `app/types/*`; add the mobile-repo
  sync-comment header to each file (REBUILD_CONCEPT §7); add `edited?: boolean` to `SHPEEventLog`
  (API.md keeps the `edited: true` write, so the type gains the field — closes the DATA_MODEL.md
  type-sync gap). **Note for Mark:** the matching change to `MobileApp/src/types/Events.ts` is carried
  over by hand in the mobile repo — outside this repo, do not forget.
- **S5 — `app/config/firebaseClient.ts`** (the `firebaseConfig.ts` rename, REBUILD_CONCEPT §6): public
  client SDK init, emulator-aware (`connectAuthEmulator` / `connectFirestoreEmulator` /
  `connectStorageEmulator` behind a dev flag), dummy `NEXT_PUBLIC_GOOGLE_API_KEY`.
- **S6 — `server/firebaseAdmin.ts`.** Init guard exactly per REBUILD_CONCEPT §9.3 snippet — no `cert()`
  when `FIRESTORE_EMULATOR_HOST` is set; the service-account branch exists but stays unwired until X1.
- **S7 — Emulators + Docker + seed.** `firebase.json` (auth/firestore/storage emulators + UI, run with
  `--import ./seed --export-on-exit`); dev-only **permissive** `firestore.rules` for the emulator with
  a header marking it NOT-production (production rules are owned by Mark at cutover); `Dockerfile`
  (bun base + JRE + firebase-tools); `docker-compose.yml` (emulators + `bun run dev`, ports
  3000/4000/8080/9099/9199, repo bind-mounted); `scripts/seed.ts` (Admin SDK against the emulator, no
  cert) creating everything in the testing baseline above.
- **S8 — Cloud Function dev stubs.** `server/lib/cloudFunctions.ts`: emulator-gated stubs for
  `updateAllUserPoints` and `sendNotificationMemberSHPE`; client-side stub hook point for `zipResume`.
  The real invocation mechanism (OIDC HTTP call vs trigger vs inline — REBUILD_CONCEPT §4) is chosen
  per function at cutover (X3).

**Phase 0 exit criteria:** `docker compose up` boots clean; `localhost:3000` renders the placeholder;
Emulator UI (4000) shows every seeded collection; `bunx tsc --noEmit` passes.

---

## Phase 1 — Foundation (F) — after Phase 0; Groups A and B run ∥

### Group A — auth plumbing

- **F1 ∥ — Auth middleware.**
  Files: `server/middleware/auth.ts`; wire into `server/app.ts`.
  Contract: API.md Conventions (Bearer ID token; **any** of `admin/officer/developer/lead/representative`;
  401 missing/invalid, 403 valid-but-claimless; standard error shape). **Binary gate — no
  `requireRole` tiers** (CLAUDE.md rule 5).
  Depends: Phase 0.
  Acceptance (emulator): unauthenticated POST to any `/api/*` → 401 with the standard error shape;
  seeded-officer token → passes middleware (404 from the empty router is fine); emulator user with no
  claims → 403.
- **F2 ∥ — Client auth: login + guard.**
  Files: `app/page.tsx` (login), `app/helpers/auth.ts`, `app/(main)/layout.tsx` (auth-guarded shell).
  Contract: PURPOSE_AND_FUNCTIONALITY § Auth (Google OAuth `hd: tamu.edu`, claim check, denied →
  sign-out + message); DESIGN_BRIEF §4.0 (login look + access-denied state); prototype login screen.
  Reference: `OLD-tamu-shpe-admin-web/app/helpers/auth.ts`. Local sign-in uses the Auth emulator's
  fake account; keep the `hd` param in code (only truly testable at X5).
  Depends: Phase 0.
  Acceptance: seeded officer signs in via emulator → lands on `/dashboard`; claimless user → signed
  out + access-denied message; unauthenticated direct nav to a `(main)` route → redirect to `/`.
- **F3 ∥ — TanStack Query setup.**
  Files: `lib/queryClient.ts`; provider wiring in `app/layout.tsx`.
  Contract: REBUILD_CONCEPT §5. Depends: Phase 0.
  Acceptance: a trivial `useQuery` renders through the provider.

### Group B — design system (independent of Group A)

All Group B — and every later UI task — uses `prototype/SHPE Admin Portal.dc.html` as the concrete
structure/design reference alongside DESIGN_BRIEF.

- **F4 ∥ — shadcn init + theme tokens.** Maroon `#500000` primary, Brand-Dark `#3C001C` / Brand-Light
  `#732F2F`, gray scale, officer-gold `#FCE300` badge token, focus ring `#E7B7B7`, `--radius` ~2px,
  Oswald / Work Sans / Open Sans (+ tabular figures) / Crimson Text via Google Fonts.
  Contract: DESIGN_BRIEF §2; prototype styles. Depends: Phase 0.
- **F5 — Navbar + PageHeader + Eyebrow.** Files: `app/components/`. Maroon bar w/ 3px Brand-Dark
  border, Oswald wordmark, active state, sign-out. Contract: DESIGN_BRIEF §3, §5; prototype.
  Depends: F4, F2 (sign-out action).
- **F6 ∥ — Shared primitives** (each component an independent implementer task): DataTable base
  (sticky header; frozen-first-column + editable-cell + row-highlight variants; zebra striping),
  StatTile (8px maroon top band, Oswald numeral), Badge set (officer-gold / verified-maroon / neutral),
  Dialog variants (large form + small confirm), Tabs, Toast/Sonner setup, Skeleton loaders, Empty
  state, Error state. Contract: DESIGN_BRIEF §5; prototype. Depends: F4.

**F4–F6 acceptance:** components render on a scratch page with the brand tokens; keyboard focus shows
the `#E7B7B7` ring; visual parity with the prototype's equivalents.

---

## Phase 2 — Vertical slice: Points edit (V) — sequential; gates the fan-out

The canonical pattern (REBUILD_CONCEPT §10): client read hook → Hono write route → atomic dual-write
batch → query invalidation → screen. Behavior reference: `OLD-tamu-shpe-admin-web/app/api/firebaseUtils.ts`
(`updatePointsInFirebase`, `getMembers`, `getEvents`) and `OLD-.../app/(main)/points/page.tsx`.

- **V1 — Batch helpers.**
  Files: `server/lib/db-helpers.ts`.
  Chunked atomic batch helper (Firestore caps 500 writes/batch ⇒ ≤250 dual-write edits per chunk;
  sequential chunks, fail-fast reporting per API.md — cross-chunk atomicity deliberately deferred) +
  per-request cache of `events/{id}.startTime` reads.
  Contract: API.md points batch-limit note. Depends: F1.
  Acceptance (emulator): a 251-edit input produces exactly 2 batches; an injected failing chunk
  reports failure rather than silent partial success.
- **V2 — `POST /api/points/edit`.**
  Files: `server/routes/points.ts`; register in `server/app.ts`.
  Body `{ edits: [{ eventId, uid, points | null }] }`, zod-validated; per edit, dual-write
  `events/{eventId}/logs/{uid}` **and** `users/{uid}/event-logs/{eventId}`, both `edited: true,
  verified: true`; backfill `creationTime`/`signInTime` from the event's `startTime`; all edits in one
  atomic batch (chunked via V1).
  Contract: API.md points table; DATA_MODEL invariant 1. Depends: V1.
  Acceptance (emulator): one call updates BOTH paths with flags + backfill visible in Emulator UI;
  malformed body → 400 with zod issues; no token → 401.
- **V3 ∥(with V2) — `POST /api/points/recalculate`.**
  Files: `server/routes/points.ts`. Invokes `updateAllUserPoints` via the S8 stub.
  Contract: API.md. Depends: F1, S8.
  Acceptance: 200 `{ ok: true }`; stub log line visible.
- **V4 — `lib/hooks/usePoints.ts`.**
  `useQuery(['points'])` / `useQuery(['members'])` assembling the spreadsheet data from the client SDK
  (June–May school year, DATA_MODEL invariant 5) + `useMutation` → `/api/points/edit` attaching the
  Firebase ID token, invalidating `['points']` + `['members']` on success, + a recalculate mutation.
  Contract: API.md client-side reads + mutation→invalidation table; CLAUDE.md rules 1 & 8. Depends: V2, V3, F3.
- **V5 — Points screen.**
  Files: `app/(main)/points/page.tsx` + components.
  Total/Monthly tabs, month selector, sticky-header/frozen-first-column grid, inline cell editing with
  dirty markers, Save-all, Update Points with progress state, officer-row highlight, Instagram-points
  columns (monthly), toasts, skeleton/empty/error states, **no manual reload buttons**.
  Contract: DESIGN_BRIEF §4.3; prototype points screen. Depends: V4, F5, F6.
- **V6 — Slice gate (orchestrator verification — not delegated).**
  End-to-end on the emulator: edit cells → Save → both Firestore paths updated atomically (checked in
  Emulator UI) → grid refreshes via invalidation without reload → toasts correct; `bunx tsc --noEmit`
  clean. **Phase 3 does not start until V6 passes.** Any pattern corrections are folded back into the
  docs first.

---

## Phase 3 — Fan-out — 5 independent tracks, safe to run fully ∥ (sequenced within each track)

### Track M — Membership

- **M1 — Approve/deny routes.**
  Files: `server/routes/membership.ts`; register in `server/app.ts`.
  `POST /:uid/approve`: copy `chapterExpiration`/`nationalExpiration` from `memberSHPE/{uid}` to
  `users/{uid}` + delete the request — **one atomic batch**; fire `sendNotificationMemberSHPE(
  { uid, type: 'approved' })` (S8 stub) only after commit succeeds. `POST /:uid/deny`: clear both
  expirations (`FieldValue.delete()`), delete request, notify `'denied'`. 404 if no request doc.
  Contract: API.md membership; DATA_MODEL invariant 3 (fixes the original's un-batched writes).
  Depends: V6.
  Acceptance (emulator): approve on a seeded request → user doc gains both expirations AND request
  doc is gone; deny → expirations removed from user doc; stub logs `{uid, type}` after commit only;
  unknown uid → 404.
- **M2 — `lib/hooks/useMembership.ts`.**
  Queries: `['membership','requests']` (validity rule — BOTH `chapterURL` and `nationalURL` non-empty),
  `['membership','official']` (`isMemberVerified`: both expirations exist and ≥ now), `['members']`.
  Mutations: approve/deny → invalidate `['membership', …]` + `['members']`.
  Contract: API.md reads table; DATA_MODEL invariants 2–3. Depends: M1, F3.
  Acceptance: the seeded invalid request (missing a URL) is excluded from `requests`.
- **M3 ∥ — MemberCard component.**
  Files: `app/components/MemberCard.tsx`. Avatar/name, badges, proof-doc links (Storage URLs),
  expirations, Approve/Deny buttons. Contract: DESIGN_BRIEF §4.4, §5; prototype. Reference:
  `OLD-.../app/components/MemberCard.tsx`. Depends: F6.
- **M4 — Membership screen.**
  Files: `app/(main)/membership/page.tsx`. Three tabs: Official Members · Requests · All Users.
  Contract: DESIGN_BRIEF §4.4; prototype. Depends: M2, M3.
  Acceptance: approving in the UI removes the card from Requests and the member appears in Official
  without reload; toasts fire on success/failure.

### Track E — Events

- **E1 — Events routes.**
  Files: `server/routes/events.ts`; register in `server/app.ts`.
  `POST /` (create — fixes the original console.log-only bug), `PUT /:id` (partial update),
  `POST /:id/logs/:uid/approve` (dual-write `verified: true` batch, mirrors points pattern),
  `POST /:id/logs/bulk-approve` (`{ uids: string[] }`, all in one batch — new feature).
  Timestamps in bodies arrive as `{ seconds, nanoseconds }` and convert to Admin `Timestamp`
  (API.md Conventions). Contract: API.md events; DATA_MODEL events section. Depends: V6.
  Acceptance (emulator): created event lands in `events/` with native Timestamps; bulk-approve flips
  `verified` on BOTH log paths for every uid atomically; invalid `eventType` → 400.
- **E2 — `lib/hooks/useEvents.ts`.**
  Queries: `['events']`, `['events', id, 'logs']`, `['events','pending']` (events having unverified
  logs). Mutations: create/update/approve/bulk-approve with invalidation of the affected keys.
  Contract: API.md reads table. Depends: E1, F3.
- **E3 ∥ — Calendar components.**
  Month/Week views, event chips (color by type/committee), Day drill-down modal.
  Contract: DESIGN_BRIEF §4.2; prototype events screen. Reference: `OLD-.../app/(main)/events/`.
  Depends: F6.
- **E4 — EventModal (create/edit).**
  Large dialog form: name, description, event type (drives which point fields show), start/end,
  buffers, location, geofencing point+radius, committee, sign-in/sign-out/per-hour points, workshop
  subtype (Workshop only), visibility flags — plus the attendee log table with per-row Approve and
  Bulk Approve. Contract: DESIGN_BRIEF §4.2; DATA_MODEL events/subtypes. Depends: E2, E3.
- **E5 — Events screen assembly.**
  Files: `app/(main)/events/page.tsx`. Calendar centerpiece + Pending Approval section.
  Depends: E4.
  Acceptance: creating an event in the UI persists to the emulator (the original bug, fixed);
  bulk-approving clears a pending card without reload.

### Track C — Committees (small)

- **C1 ∥ — `lib/hooks/useCommittees.ts`.** `['committees']`, read-only — **no router** (API.md).
  Depends: F3 (pattern follows V6). 
- **C2 — Committees screen + CommitteeCard.**
  Files: `app/(main)/committees/page.tsx`, `app/components/CommitteeCard.tsx`.
  Committee-color accent band, logo, description, **head + leads completed** (original was stubbed —
  REBUILD_CONCEPT §8), member count. Contract: DESIGN_BRIEF §4.5; DATA_MODEL committees; prototype.
  Depends: C1, F6.
  Acceptance: seeded committees render with head and leads resolved.

### Track T — Tools

- **T1 — Shirt toggle route.**
  Files: `server/routes/tools.ts`; register in `server/app.ts`.
  `POST /shirts/:uid/toggle` body `{ shirtPickedUp: boolean }` → update `shirt-sizes/{uid}`.
  Contract: API.md tools. Depends: V6.
  Acceptance (emulator): doc field flips; non-boolean body → 400.
- **T2 — `lib/hooks/useTools.ts`.**
  `['shirts']` query (join `shirt-sizes` + members), toggle mutation (invalidate `['shirts']`),
  raw `onSnapshot` listeners on `resumes/status` + `resumes/data` (outside TanStack Query), and the
  client `httpsCallable('zipResume')` behind the dev stub — the ONE deliberate client-side
  mutation-trigger exception (API.md). Depends: T1, F3.
- **T3 — Tools screen.**
  Files: `app/(main)/tools/page.tsx`. Resume panel with idle → generating → ready → expired states;
  link to shirt tracker. Contract: DESIGN_BRIEF §4.6; prototype. Depends: T2, F6.
- **T4 — Shirt-tracker screen.**
  Files: `app/(main)/tools/shirt-tracker/page.tsx`. Table (name, email, membership status, size,
  picked-up checkbox), search/filter, picked-up vs remaining counts. Contract: DESIGN_BRIEF §4.6a;
  prototype. Depends: T2, F6.
  Acceptance: toggling updates the emulator doc and counts without reload; resume panel states
  exercised by hand-editing `resumes/*` in the Emulator UI.

### Track P — Points extras

- **P1 ∥ — Excel export (client-side — no route, API.md resolved decision).**
  ExcelJS + file-saver, multi-sheet (master + per-month), from data already held client-side.
  Reference: `OLD-.../app/(main)/points/page.tsx` export logic. Depends: V5.
  Acceptance: downloaded workbook matches seeded data (spot-check one member's totals).

---

## Phase 4 — Dashboard (D) — last screen; consumes Phase 3 hooks

- **D1 — Dashboard screen.**
  Files: `app/(main)/dashboard/page.tsx`.
  Stat tiles (pending membership requests, events needing approval, active members, recalc status),
  recent-requests card (3–5 w/ Review links), top-5 points leaderboard card — all **reusing existing
  query keys** (`['membership','requests']`, `['events','pending']`, `['members']`, `['points']`);
  every tile clicks through. Contract: DESIGN_BRIEF §4.1; REBUILD_CONCEPT §8; prototype dashboard.
  Depends: M2, E2, V4, F6.
  Acceptance: counts equal seeded reality; approving a request elsewhere updates the tile via
  invalidation without reload.

---

## Phase 5 — Hardening (H) — orchestrator-led

- **H1 — Full emulator regression.** Every screen and write path exercised; 401/403 + error-shape spot
  checks on all routes; loading/empty/error states verified per screen (DESIGN_BRIEF §7.5).
- **H2 — Docs sync pass.** Update the five design docs wherever implementation clarified a contract;
  repoint stale `../app/...` links at `OLD-tamu-shpe-admin-web/...`; run the DATA_MODEL type-sync
  checklist (incl. confirming the `SHPEEventLog.edited` mobile-repo mirror was carried over by Mark).

---

## Phase 6 — Credential cutover / go-live (X) — direct, sequential, deliberately last

(REBUILD_CONCEPT §10 step 8 — nothing here starts until Phases 0–5 are done. Production security
rules and provisioning steps are owned by Mark.)

- **X1** — Vercel env: real `FIREBASE_SERVICE_ACCOUNT_KEY` (server-only, not `NEXT_PUBLIC_`) +
  production web API key for Production/Preview/Development; confirm `runtime = 'nodejs'` on the mount.
- **X2** — Provision real officer/developer custom claims in Firebase (manual, same process as today).
- **X3** — Replace the S8 dev stubs with real invocations of `updateAllUserPoints` and
  `sendNotificationMemberSHPE` — choose the REBUILD_CONCEPT §4 mechanism (OIDC-token HTTP call vs
  trigger conversion vs inline) per function and note it in the route. `zipResume` stays a client
  callable, unstubbed.
- **X4** — Verify production Firestore **read** rules grant officers the client-side reads this app
  performs (rules are load-bearing for all reads and live outside this repo — REBUILD_CONCEPT §3).
- **X5** — Production smoke test of every write path (incl. the `hd: tamu.edu` login restriction,
  untestable on the emulator) + go-live.

---

## Resolved planning notes

1. **Legacy app links.** `OLD-tamu-shpe-admin-web/` exists only for referencing old code. Stale doc
   links get repointed in H2 (cosmetic, not blocking).
2. **`SHPEEventLog.edited` mobile mirror.** Added here in S4; the `MobileApp/src/types/Events.ts`
   mirror is carried over by Mark in the mobile repo.
3. **Multi-chunk batch failure semantics** (API.md "still open"): sequential chunks + fail-fast
   reporting; cross-chunk atomicity deferred until saves approach the 250-edit cap.
4. **Emulator Firestore rules.** Dev-only permissive rules file, header-marked NOT-production;
   production rules/steps handled by Mark at cutover.
5. **Local login.** `hd: tamu.edu` stays in code; local sign-in uses the Auth emulator's fake account;
   the domain restriction is verified at X5.

## Orchestration notes

- Phase 0 and the V6/H/X gates are orchestrator work, done directly.
- Phases 1–4 tasks are sized for one `implementer` agent each; fan out per the ∥ markers. Use `scout`
  before any task where the legacy app's behavior needs tracing first.
- Architecture calls, trade-offs, and doc edits stay with the orchestrator (CLAUDE.md § Orchestration).
