# TAMU SHPE Admin Web — Rebuild Architecture & Conventions

**Status:** Planning complete, implementation not yet started — repo currently holds the *original* client-side app; the new stack (Hono, TanStack Query, Admin SDK, shadcn/ui) is not installed yet (see Section 10, step 0)
**Team:** 2 developers, heavily AI-tool-assisted
**Scope:** Full rebuild in a new repo (not a refactor of the existing one)
**Original repo purpose:** See `PURPOSE_AND_FUNCTIONALITY.md` for the full feature/data-model breakdown this rebuild is based on. That document is the source of truth for *what* the app must do; this document defines *how* it will be built.

This file exists to be handed to AI coding tools (Claude Code, etc.) as standing context. Keep it updated as decisions change — outdated architecture docs are worse than none, since AI tools will trust and propagate what's written here.

---

## 1. Why Rebuild

The original app was:
- Built more from-scratch than necessary (hand-rolled UI instead of a component library)
- Visually unpolished
- Missing a real server boundary — all Firestore writes happened client-side via the Firebase JS SDK, relying entirely on Firestore Security Rules + Auth custom claims for protection
- Left with known incomplete features (see Section 8)

This rebuild keeps the *same Firebase project* (`tamushpemobileapp`) and the *same data model*, but introduces a real server layer and a proper component-based UI.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | Same as original |
| UI | React 18, Tailwind CSS, **shadcn/ui** | New — replaces hand-rolled components |
| Language | TypeScript | Same |
| Server API layer | **Hono**, mounted under one catch-all Route Handler | New — see Section 4 |
| Data fetching (client) | **TanStack Query** | New — replaces manual localStorage caching |
| Backend | Firebase Auth, Firestore, Storage, Cloud Functions | Same Firebase project as mobile app |
| Admin access | Firebase Admin SDK + service account | New — server-only, was previously absent |
| Utilities | date-fns, ExcelJS + file-saver | Same |
| Hosting | Vercel | Same |
| Path alias | `@/*` → `./app/*`, **plus** `@/server/*` → `./server/*` and `@/lib/*` → `./lib/*` | Changed — see note |

> **Path alias must be extended (compile-breaking otherwise).** The existing [`tsconfig.json`](../tsconfig.json) only defines `"@/*": ["./app/*"]`. But `server/` and `lib/` are top-level directories (Sections 4 & 6), so `import { app } from '@/server/app'` would resolve to `./app/server/app` — which does not exist. Before the first vertical slice compiles, add the extra alias entries:
> ```jsonc
> "paths": {
>   "@/*":        ["./app/*"],
>   "@/server/*": ["./server/*"],
>   "@/lib/*":    ["./lib/*"]
> }
> ```
> Also bump `"target": "es5"` (current value) to `"es2017"` or later — the Node server runtime and Admin SDK have no reason to down-compile to ES5.

---

## 3. Core Architectural Decision: Server Layer

### The problem in the original app
All writes happened client-side under the signed-in user's own Firebase credentials. The **only** thing standing between a browser (or anyone able to present a valid ID token) and arbitrary Firestore mutations is Firestore Security Rules. That means every write path's authorization, validation, and "which documents may this operation touch" lives in Security Rules — which are not in this repo, are hard to review/test, and drift out of sync with app logic over time.

> **Correction to an earlier assumption:** this rebuild was initially motivated by a belief that client-side multi-document writes weren't atomic. They *are*. The original `updatePointsInFirebase` ([`app/api/firebaseUtils.ts`](../app/api/firebaseUtils.ts)) already commits both the event log and the user mirror in a single Firestore `writeBatch().commit()`, which is all-or-nothing regardless of where it runs — a dropped connection cannot leave the two collections half-written. **Atomicity was never the gap.** The gap is *trust*: the batch and its rules are defined client-side. Moving the write server-side doesn't make it more atomic; it makes it enforceable in code we own, under a service account, instead of in Security Rules.

### The decision
**Introduce a real server API layer using Hono, mounted inside a single Next.js Route Handler**, rather than:
- Continuing all-client-side writes (original approach — rejected: leaves all write authorization in Security Rules, unreviewable and untestable in this repo)
- Using Next.js Server Actions (considered — rejected in favor of Hono, see rationale below)

### What the server layer actually buys us
- **A trust boundary we control in code.** Writes execute under a service account (Admin SDK), so client-side Security Rules no longer need to grant broad write access. Validation and authorization live in reviewable TypeScript, not in rules.
- **One place to verify identity + claims** (Section 4 middleware) instead of encoding it per-collection in rules.
- **Keeps cross-document batches tamper-proof** — the client can no longer choose which documents a "points edit" touches; the route decides.

### Why Hono over Server Actions
- Auth/claims verification lives in **one middleware**, applied once, rather than being re-checked inside every individual Server Action
- Produces a real, inspectable HTTP API surface — easier to reason about, test, and hand to AI tools with an explicit contract, vs. Server Actions' implicit RPC-over-POST mechanism
- Pairs naturally with TanStack Query's `useMutation`, which expects a `fetch`-shaped call
- No progressive-enhancement / `<form>` benefit is needed here (no flows depend on JS-disabled submission), so Server Actions' main advantage doesn't apply
- Matches the team's existing mental model of an explicit client/server split

### The read/write boundary
- **Reads and live listeners → client Firebase SDK directly**, wrapped in TanStack Query (`useQuery`). Includes calendar data, points spreadsheet display, membership lists, committee directory, and real-time listeners like resume zip status (`onSnapshot`, kept outside TanStack Query since it's push-based).
- **Cross-document writes and anything security-sensitive → Hono routes on the server**, using the Firebase Admin SDK with a service account. Includes points edits (dual-write), membership approve/deny, event creation, bulk attendance approval.

> **Consequence — be explicit about this:** the server boundary is **write-only**. All reads stay on the client SDK, so **Firestore Security Rules remain fully load-bearing for every read** and must still be maintained (they are not in this repo). The auth middleware in Section 4 guards writes only; it does nothing for reads. Reads also include PII — `users/{uid}/private/privateInfo` (email, resume URL, push tokens) and membership proof URLs — which means read rules must grant officers broad client-side read access to other members' sensitive data, and that data is fetched into the browser. This is an acceptable trade for an internal officer tool, but it is a deliberate exposure, not something the server layer eliminates. If any read ever needs to be hidden from the client, it must move to a Hono route too.

---

## 4. Server Layer Structure

Hono is mounted under **one** catch-all Route Handler. All actual logic lives outside `app/`, in a plain-TypeScript `server/` directory with no Next.js coupling — this keeps it testable and keeps AI tools from needing to reason about App Router conventions when working on route logic.

```
app/api/[[...route]]/route.ts   # thin mount point only — imports server/app.ts and calls handle()
```

```ts
// app/api/[[...route]]/route.ts
export const runtime = 'nodejs'   // REQUIRED — Admin SDK does not run on Edge runtime

import { handle } from 'hono/vercel'
import { app } from '@/server/app'

export const GET = handle(app)
export const POST = handle(app)
```

### Routes are organized by **workflow/usage**, not by Firestore collection

Decision: group endpoints the way an officer thinks about the task, not by which collection they touch. E.g. membership approve/deny touches both `users` and `memberSHPE` plus a Cloud Function call — it's still one file, because it's one workflow.

```
server/
├── app.ts                 # Hono app, registers all sub-routers, applies global auth middleware
├── middleware/
│   └── auth.ts            # verifies Firebase ID token + custom claims (admin/officer/developer/lead/representative)
├── routes/
│   ├── membership.ts      # approve / deny (writes only; reads are client hooks)
│   ├── points.ts          # dual-write edit / recalculate (+ maybe export)
│   ├── events.ts          # create / update / approve (single + bulk)
│   └── tools.ts           # shirt tracker toggle (resume-zip trigger stays client-side)
│                          # no committees.ts — committees are read-only (client hook)
├── lib/
│   └── db-helpers.ts      # shared batch-write helpers, shared query logic
└── firebaseAdmin.ts        # Admin SDK init (guarded against re-init on cold start reuse)
```

### Verb convention (locked in): **`approve` / `deny`**

Any endpoint representing an officer decision uses `approve`/`deny` — not `accept`/`reject`, not `confirm`/`decline`. Applies across membership requests, event attendance logs, and any future decision-based workflow. This matters for consistency across AI-generated code written in separate sessions by different people.

### Access model — who actually uses this, and how they get in

Two kinds of users, both provisioned the **same way and by the same process as today** (this rebuild does not change it):

- **Officers** — the primary users. They sign in through a **single shared TAMU SHPE Google account** (`@tamu.edu`). All officer usage flows through this one identity.
- **Developers** — effectively admins, on their own accounts.

Access is granted by **manually adding the account in Firebase** (setting custom claims). There is no self-serve onboarding, invite flow, or role-management UI to build — and none is planned. The app only ever *reads* claims to gate access; it never grants them.

**Two implications the rebuild must respect:**

1. **The auth gate is binary, and stays that way — no role tiers to encode.** Access is all-or-nothing: if the account was added in Firebase (has *any* of `admin`/`officer`/`developer`/`lead`/`representative`), it gets in with full access. The login flow ([`app/helpers/auth.ts`](../app/helpers/auth.ts)) already works this way, and the Section 4 middleware should keep that shape: assert "presents a valid ID token with ≥1 recognized claim," and that's the whole check. **Do not build per-route `requireRole(...)` distinctions** — an officer-vs-developer split is explicitly *not* wanted right now. (Firestore Security Rules and the manual claim-provisioning step remain the backstop if finer control is ever needed later.)
2. **No per-person attribution is possible.** With a shared officer login, `edited: true` / `verified: true` flags and any future audit fields cannot identify *which* officer acted. Don't design features (activity logs, "approved by", accountability trails) that assume individual attribution — the identity model can't support it. If per-person accountability is ever required, that's a change to the access model itself, out of scope here.

### Invoking Cloud Functions from the server

The original calls `updateAllUserPoints`, `sendNotificationMemberSHPE`, and `zipResume` client-side via `httpsCallable` (see [`app/(main)/points/page.tsx`](../app/(main)/points/page.tsx), [`membership/page.tsx`](../app/(main)/membership/page.tsx), [`tools/page.tsx`](../app/(main)/tools/page.tsx)). **The Admin SDK has no `httpsCallable`** — a Hono route cannot invoke a callable function the same way. When these calls move server-side, pick one per function and note it in the route:

- Call the function's HTTPS endpoint directly with a server-minted OIDC/identity token, **or**
- Convert it to a Firestore/PubSub-triggered function and let the route's write fire the trigger, **or**
- Inline the logic into the route if it's small enough that the round-trip isn't worth it.

**Decided:** `zipResume` (fire-and-forget from Tools) **stays a client `httpsCallable`** — it isn't a client Firestore write (the function writes `resumes/*` under its own service account and self-authorizes), so a server route would add Admin-SDK-to-callable plumbing for no security gain. This is the one deliberate client-side mutation-trigger exception. All *other* Cloud Function calls that pair with a Firestore write (`updateAllUserPoints`, `sendNotificationMemberSHPE`) run from their Hono routes. See [`docs/API.md`](./API.md).

### Example route shapes (writes/privileged actions only)

Per the write-only boundary above, **the routers hold only writes and privileged actions — no `GET` data routes** (reads live in client hooks, Section 5). [`docs/API.md`](./API.md) is the authoritative contract; the sketch below just shows the module grouping.

```ts
// server/routes/membership.ts
membershipRouter
  .post('/:uid/approve', ...)   // update users/{uid} expirations + delete memberSHPE/{uid} + notify (one batch)
  .post('/:uid/deny', ...)      // clear expirations + delete memberSHPE/{uid} + notify (one batch)

// server/routes/points.ts
pointsRouter
  .post('/edit', ...)                // batch of cell edits, one atomic dual-write batch
  .post('/recalculate', ...)         // calls updateAllUserPoints Cloud Function
  // Excel export is client-side (ExcelJS) — no route; see API.md

// server/routes/events.ts
eventsRouter
  .post('/', ...)                         // CREATE — fixes original bug (was console.log only)
  .put('/:id', ...)
  .post('/:id/logs/:uid/approve', ...)
  .post('/:id/logs/bulk-approve', ...)    // fixes original missing bulk-approve feature
```

The corresponding reads (`official`/`requests`/`all-users`, points spreadsheet data, calendar, `pending`) are **client hooks**, not routes — see [`docs/API.md`](./API.md) § "Client-side reads."

If usage-based grouping ever causes duplication pain (e.g. shared recalculation logic needed by both points and events), extract shared logic into `server/lib/` — the router files don't need to be reshuffled, only their internals.

---

## 5. Client-Side Data Layer

```
lib/
├── queryClient.ts          # TanStack Query client setup
└── hooks/
    ├── usePoints.ts        # useQuery (client SDK read) + useMutation (fetch → points router write)
    ├── useMembership.ts
    ├── useEvents.ts
    ├── useCommittees.ts
    └── useTools.ts
```

Pages never call Firebase or Hono directly — they call hooks (`usePoints()`, `useMembership()`, etc.). This is the layer that replaces the original's manual 24-hour localStorage cache + manual reload buttons:

- Reads use `useQuery` calling the **client Firebase SDK directly** (not the Hono API), with per-resource query keys (e.g. `['events']`, `['members']`) — see [`docs/API.md`](./API.md) § "Client-side reads" for the full list
- Writes use `useMutation` calling **`fetch` against the Hono routes**, then `queryClient.invalidateQueries()` on success to auto-refresh instead of requiring a manual reload button
- Real-time listeners (resume zip status) remain raw `onSnapshot`, outside TanStack Query

---

## 6. Directory Layout (Full)

```
app/
├── page.tsx                      # Login (/)
├── layout.tsx                    # Root layout
├── (main)/
│   ├── layout.tsx                # Auth-guarded shell + Navbar
│   ├── dashboard/page.tsx        # Real summary widgets (not a stub — see Section 8)
│   ├── events/page.tsx
│   ├── points/page.tsx
│   ├── membership/page.tsx
│   ├── committees/page.tsx
│   └── tools/page.tsx
│
├── api/
│   └── [[...route]]/
│       └── route.ts              # the ONLY route.ts — Hono mount point
│
├── components/                   # shadcn/ui-based components (Navbar, tables, modals, cards)
├── config/
│   └── firebaseClient.ts         # PUBLIC client SDK config — used for reads/auth popup only
├── helpers/
│   └── auth.ts                   # client-side auth helpers
└── types/                        # mirrored with mobile app (see Section 7)

server/                           # plain TypeScript, no Next.js coupling
├── app.ts
├── middleware/auth.ts
├── routes/
│   ├── membership.ts             # writes only (approve/deny) — no committees router (read-only)
│   ├── points.ts
│   ├── events.ts
│   └── tools.ts
├── lib/db-helpers.ts
└── firebaseAdmin.ts               # SERVER-ONLY — service account, never imported client-side

lib/
├── queryClient.ts
└── hooks/
    ├── usePoints.ts
    ├── useMembership.ts
    ├── useEvents.ts
    ├── useCommittees.ts
    └── useTools.ts
```

**Deliberate separation:** `config/firebaseClient.ts` (public config, safe for client) and `server/firebaseAdmin.ts` (service account, server-only) live in different top-level folders so it's immediately visually obvious which is safe to import from a client component.

> **Note:** the existing file is [`app/config/firebaseConfig.ts`](../app/config/firebaseConfig.ts) — rename it to `firebaseClient.ts` as part of the rebuild (and update the `@/config/firebaseConfig` import in [`app/helpers/auth.ts`](../app/helpers/auth.ts)) so the client/server naming split is unambiguous. If the rename is skipped, use `firebaseConfig.ts` consistently throughout this doc instead.

---

## 7. Data Model & Types

This repo is **separate from the mobile app monorepo** but shares the same Firestore database (`tamushpemobileapp`). Types in `app/types/` are **manually mirrored** with `MobileApp/src/types/*` — not extracted into a shared package, since the repos are independent.

**Convention:** add a comment block at the top of each mirrored types file noting it must be kept in sync with the mobile app repo on any schema change, to survive contributor turnover.

Collections (unchanged from original — see `PURPOSE_AND_FUNCTIONALITY.md` for full schema detail):
- `users/{uid}` — public profiles
- `users/{uid}/private/privateInfo` — sensitive info
- `users/{uid}/event-logs/{eventId}` — per-user attendance mirror
- `events/{eventId}` — event metadata
- `events/{eventId}/logs/{userId}` — canonical per-event attendance logs
- `memberSHPE/{uid}` — pending membership verification
- `shirt-sizes/{uid}` — shirt submissions
- `committees/{id}` — committee metadata
- `resumes/status`, `resumes/data` — resume zip job status

### Dual-write pattern — now server-enforced

Points edits write to both the canonical event log (`events/{eventId}/logs/{userId}`) and the user-centric mirror (`users/{uid}/event-logs/{eventId}`). This was **already a single atomic `writeBatch`** in the original ([`updatePointsInFirebase`](../app/api/firebaseUtils.ts)); the rebuild does not change its atomicity. What changes is *where it runs and who's trusted*: the batch moves into a Hono route (`server/routes/points.ts`) executing under the service account, so the set of documents a points edit may touch — and the `verified: true` / `edited: true` flags it sets — are decided by server code, not by whatever the client sends. See Section 3 for why this is a trust fix, not an atomicity fix.

---

## 8. Known Gaps From Original App — To Be Fixed, Not Just Ported

| Area | Original status | Rebuild plan |
|---|---|---|
| Dashboard | Empty placeholder | Build real summary widgets (pending approval count, recent membership requests, points leaderboard preview) once other modules exist |
| Event create/edit | Form UI complete, `handleSubmit` only `console.log`s — never persisted | New `POST /events` route actually writes to Firestore |
| Bulk approve (event logs) | Missing entirely | New `POST /events/:id/logs/bulk-approve` route |
| Committee heads | Partially stubbed | Complete during committees module build |
| Server-side API | None existed | Entire point of this rebuild — see Section 3/4 |

---

## 9. Environments — Local Dev, Testing & Deployment

**Credentials-last principle.** No real Firebase credentials (service-account key or production web API key) are added until the final cutover step (Section 10). *All* development and testing runs against the **Firebase Emulator Suite** with no real secrets — nothing in the repo or the dev container can touch the production `tamushpemobileapp` data until deliberately wired up at the end.

### 9.1 Local development (Docker + Firebase Emulator Suite)

Development is containerized so setup is one command and identical across the 2-person team. `docker compose up` boots the emulators **and** `bun run dev` together.

- **Image:** `bun` base + a JRE (`default-jre` / `openjdk`) — **the Firebase emulators require Java** — plus `firebase-tools` (installed via `bunx`/global). The repo is bind-mounted for live editing; `node_modules`/`.next` stay in the container.
- **Ports exposed:** `3000` (Next.js), `4000` (Emulator UI), `8080` (Firestore), `9099` (Auth), `9199` (Storage).
- **No secrets in the container.** Dev env uses a **dummy** `NEXT_PUBLIC_GOOGLE_API_KEY` (the Auth emulator doesn't validate it) and the emulator-host env vars below. The real service account is absent by design.
- **Emulator-aware config (both SDKs):** the client SDK calls `connectAuthEmulator`/`connectFirestoreEmulator`/`connectStorageEmulator` when a dev flag is set; the Admin SDK keys off the standard `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` env vars (see the init guard in 9.3).

### 9.2 Testing (Emulator Suite)

- **`firebase.json`** configures the Auth, Firestore, and Storage emulators + the Emulator UI. Use `--import ./seed --export-on-exit` so data persists between runs.
- **Seed script** (Admin SDK pointed at the emulator, no real cert needed): creates a **test officer account carrying the `officer` custom claim** — this is how the binary auth gate (Section 4) is exercised without real Google OAuth or manual Firebase provisioning — plus representative documents for every collection in Section 7 (users + private info, events + logs, `memberSHPE`, `shirt-sizes`, `committees`).
- **Cloud Functions are NOT emulated here.** `updateAllUserPoints`, `sendNotificationMemberSHPE`, and `zipResume` live in a separate repo (Section 4). The Functions emulator is out of scope; routes/hooks that invoke them use a **dev stub** (log/no-op or canned response) gated on the emulator flag. See Section 11.

### 9.3 Production deployment (Vercel)

Still a single Next.js app — Hono is a library inside it, not a separate service. No new Vercel project needed. **Everything below is wired at cutover (Section 10, final step), not during the build.**

- **Runtime:** explicitly set `export const runtime = 'nodejs'` in the catch-all route — Vercel may otherwise default to Edge, which cannot run the Firebase Admin SDK.
- **Service account:** stored as a server-only Vercel environment variable (e.g. `FIREBASE_SERVICE_ACCOUNT_KEY`, stringified JSON), **not** prefixed `NEXT_PUBLIC_`. Set separately for Production, Preview, and Development in the Vercel dashboard.
- **Admin SDK init guard — emulator-aware.** Avoids "Firebase app already exists" on serverless reuse *and* runs credential-free against the emulator (no `cert()` when the emulator host env vars are present):
  ```ts
  import { getApps, initializeApp, cert } from 'firebase-admin/app'
  const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST
  export const adminApp = getApps().length
    ? getApps()[0]
    : initializeApp(
        useEmulator
          ? { projectId: 'tamushpemobileapp' }              // emulator: no real credentials
          : { credential: cert(serviceAccount) }            // production: real service account
      )
  ```
- **CORS:** not needed — Hono routes are same-origin, called only from this app's own frontend via TanStack Query.

---

## 10. Build Approach — AI-Tool-Assisted, 2-Person Team

- Build **one full vertical slice first** (recommended: Points edit flow — Hono route + TanStack Query hook + shadcn UI component) to establish the canonical pattern. Every subsequent module follows "do this again for X" rather than inventing a new shape.
- Split work **by feature/module**, not by frontend/backend layer, so each person owns a route + hook + UI end-to-end and isn't blocked on the other mid-week.
- **Standing context doc set** (all fed to AI coding tools; keep current):
  - [`CLAUDE.md`](../CLAUDE.md) (repo root) — short always-loaded index + hard rules
  - This document (`docs/REBUILD_CONCEPT.md`) — architecture & conventions (the *how*)
  - [`PURPOSE_AND_FUNCTIONALITY.md`](./PURPOSE_AND_FUNCTIONALITY.md) — features & behavior (the *what*)
  - [`DATA_MODEL.md`](./DATA_MODEL.md) — Firestore schema & type contract
  - [`API.md`](./API.md) — HTTP endpoint contract
  Generated code should follow these rather than reinventing conventions per session.
- **Human review priority:** Hono routes touching writes (the actual security boundary, using the service account) warrant closer manual review than UI code, even when AI-drafted.

### Suggested build order
0. **Setup / preconditions** (none of this is in the repo yet — [`package.json`](../package.json) still carries only the original stack):
   - **Use `bun` as the package manager** (`bun install`, `bun run dev`, `bunx` for one-off tools like the shadcn CLI) — not yarn/npm. The original app used yarn; the rebuild does not. Commit `bun.lock`; do not carry over `yarn.lock`.
   - Add dependencies with `bun add`: `hono`, `@tanstack/react-query`, `firebase-admin`, `zod` (recommended for request-body validation in routes), and the shadcn/ui toolchain (`tailwind-merge`, `class-variance-authority`, `@radix-ui/*`, `lucide-react`).
   - Extend `tsconfig.json` path aliases (`@/server/*`, `@/lib/*`) and bump `target` to `es2017`+ — see Section 2.
   - Create the `server/` and `lib/` top-level trees and the catch-all `app/api/[[...route]]/route.ts` mount.
   - Rename `config/firebaseConfig.ts` → `firebaseClient.ts` (Section 6).
   - **Stand up the local environment (Section 9.1/9.2): `Dockerfile` + `docker-compose.yml`, `firebase.json` emulator config, emulator-aware SDK init (client + Admin), and the seed script (test officer with `officer` claim + sample data).** This is what unblocks all module work — **no real credentials yet** (see final step).
   - *(Deferred to the final step, NOT now:)* real `FIREBASE_SERVICE_ACCOUNT_KEY` / web API key in Vercel.
1. Scaffold + auth (Google OAuth restricted to `tamu.edu`, custom claims check, protected layout) — binary gate per the shared-account access model (Section 4); no role-management UI to build
2. Design system pass (shadcn/ui install, maroon `#500000` theme, shared layout/table/modal primitives)
3. Points module (reference vertical slice)
4. Membership module
5. Events module (includes fixing the two known bugs)
6. Committees + Tools
7. Dashboard (built last, once real data exists to summarize)
8. **Credential cutover / go-live (deliberately last):** add the real `FIREBASE_SERVICE_ACCOUNT_KEY` and production web API key to Vercel (Production/Preview/Development — Section 9.3), point the app at the real `tamushpemobileapp` project instead of the emulator, provision the real officer/developer accounts' custom claims in Firebase, wire the real Cloud Function calls (replacing the dev stubs from Section 9.2), and smoke-test every write path against production. Until this step, everything above runs entirely on the Emulator Suite.

---

## 11. Open Items / Things to Revisit

- ~~Excel export server-side vs client-side~~ — **decided: client-side** via ExcelJS (the browser already holds the points data; see [`docs/API.md`](./API.md)).
- **Cloud Functions in local dev** — they live in a separate repo and are not run under the Functions emulator (Section 9.2). Decide per function whether the dev stub stays a no-op or should replay a canned response; revisit if a module's behavior genuinely depends on the function's output during development.
- Whether caching beyond TanStack Query's defaults is needed for any specific page
- Formal test strategy for `server/` routes (structure supports it — plain TypeScript, no Next.js coupling — but not yet set up)