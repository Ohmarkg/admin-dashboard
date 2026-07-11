# CLAUDE.md — TAMU SHPE Admin Web

Standing context for AI coding tools. Keep this short and current — it is loaded every session. Detailed context lives in the linked docs; do not duplicate it here.

## What this is

Internal admin portal for the Texas A&M SHPE chapter — a web companion to the chapter mobile app, on the **same Firebase project** (`tamushpemobileapp`). Officers (via one shared `@tamu.edu` account) and developers use it to manage membership verification, attendance points, events, committees, and batch tools. Not public-facing.

**Current state:** rebuild planned but not started. The repo still holds the *original* client-side app. The new stack (Hono, TanStack Query, Firebase Admin SDK, shadcn/ui) is not installed yet — see [docs/REBUILD_CONCEPT.md](docs/REBUILD_CONCEPT.md) §10 step 0.

## Doc map

| Need | Read |
|---|---|
| Architecture, conventions, the *how* | [docs/REBUILD_CONCEPT.md](docs/REBUILD_CONCEPT.md) |
| What the app does, feature-by-feature | [docs/PURPOSE_AND_FUNCTIONALITY.md](docs/PURPOSE_AND_FUNCTIONALITY.md) |
| Firestore schema + type contract | [docs/DATA_MODEL.md](docs/DATA_MODEL.md) |
| HTTP endpoint contract | [docs/API.md](docs/API.md) |
| UI/UX design brief (for design tools) | [docs/DESIGN_BRIEF.md](docs/DESIGN_BRIEF.md) |

## Hard rules (do not violate without updating the docs first)

1. **Reads → client Firebase SDK** (wrapped in TanStack Query hooks). **Writes and privileged actions → Hono routes** (server, Admin SDK). The server boundary is **write-only** — there are no read/`GET` data routes. See [docs/API.md](docs/API.md).
2. **Never import `server/firebaseAdmin.ts` (or anything under `server/`) from a client component.** The service account is server-only. Public client config lives in `config/firebaseClient.ts`.
3. **`app/api/[[...route]]/route.ts` is the only `route.ts`** — a thin Hono mount. It must set `export const runtime = 'nodejs'` (the Admin SDK cannot run on Edge). All route logic lives in `server/`, free of Next.js coupling.
4. **Officer decisions use the verbs `approve` / `deny`** — never accept/reject or confirm/decline.
5. **Auth is a single binary gate:** a valid Firebase ID token with *any* recognized custom claim (`admin`/`officer`/`developer`/`lead`/`representative`) grants full access. Do **not** build per-route role tiers or a role-management UI. Claims are provisioned manually in Firebase.
6. **Cross-document writes go through one atomic Firestore batch** in the owning Hono route. The dual-write (points → event log + user mirror) is the canonical example.
7. **`app/types/` is manually mirrored from the mobile app** (`MobileApp/src/types/*`). Any schema change must be reflected in both repos and in [docs/DATA_MODEL.md](docs/DATA_MODEL.md).
8. **Pages never call Firebase or `fetch` directly** — they call hooks in `lib/hooks/`.

## Layout (target)

- `app/` — pages, components, client config, types. Path alias `@/*` → `./app/*`.
- `server/` — Hono app, middleware, routes, Admin SDK. Alias `@/server/*` → `./server/*`.
- `lib/` — TanStack Query client + hooks. Alias `@/lib/*` → `./lib/*`.

(The `@/server/*` and `@/lib/*` aliases must be added to `tsconfig.json` — see [docs/REBUILD_CONCEPT.md](docs/REBUILD_CONCEPT.md) §2.)

## Stack

Next.js 14 (App Router) · React 18 · TypeScript · Tailwind + shadcn/ui · Hono · TanStack Query · Firebase (Auth/Firestore/Storage/Functions) client SDK + Admin SDK · Vercel.

**Package manager: bun.** The rebuild uses `bun` (`bun install`, `bun run dev`, `bunx`) — not yarn or npm. (The original app in `OLD-tamu-shpe-admin-web/` used yarn; do not carry that forward.) There should be a `bun.lock`, not a `yarn.lock`, in the new tree.

**Local dev/test runs on the Firebase Emulator Suite, in Docker** (`docker compose up` boots emulators + `bun run dev`). **No real credentials until the final cutover step** — no service-account key or production API key is needed or committed; both SDKs init emulator-aware (Admin SDK skips `cert()` when `FIRESTORE_EMULATOR_HOST` is set). See [docs/REBUILD_CONCEPT.md](docs/REBUILD_CONCEPT.md) §9.

## Orchestration (when running on a high-tier main model)

Two Sonnet-backed subagents exist in `.claude/agents/`: **`implementer`** (spec-driven coding — one route/hook/component/type at a time) and **`scout`** (read-only research — locate helpers, trace the original app, confirm shapes against the docs). When the main model is a top tier (e.g. Fable), act as an orchestrator: keep architecture, trade-off calls, doc edits, and review for yourself, and delegate routine, well-scoped work to these agents. Hand each a precise spec (target file, contract from `docs/API.md`/`docs/DATA_MODEL.md`, acceptance criteria) rather than an open-ended goal; fan out independent units in parallel. Delegation is optional — do it when it saves orchestrator effort without risking correctness, not reflexively.
