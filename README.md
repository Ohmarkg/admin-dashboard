# TAMU SHPE Admin Web

Internal admin portal for the Texas A&M SHPE chapter. Officers use this Next.js app to manage the same Firebase backend (`tamushpemobileapp`) as the chapter mobile app — events, membership verification, points, committees, and operational tools.

Access is restricted to `@tamu.edu` Google accounts with Firebase custom claims (`admin`, `officer`, or `developer`).

## Features

| Route | Purpose |
|-------|---------|
| `/dashboard` | Post-login landing (stub) |
| `/events` | Event calendar and pending attendance approvals |
| `/points` | School-year points ledger with edit, export, and recalculation |
| `/membership` | SHPE membership verification (approve/deny requests) |
| `/committees` | Committee CRUD, rosters, leadership, and join-request review |
| `/tools` | Resume zip generation and shirt pickup tracker |

For a full architecture breakdown, data model, and feature documentation, see **[docs/PURPOSE_AND_FUNCTIONALITY.md](docs/PURPOSE_AND_FUNCTIONALITY.md)**.

## Getting Started

Local development runs entirely against the **Firebase Emulator Suite** — no real Firebase credentials are needed (or present) until go-live cutover.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- [Bun](https://bun.sh) (only if running the app outside Docker)

### Docker (recommended)

One command boots the emulators, seeds fixture data, and starts the Next.js app:

```bash
docker compose up
```

| Service | URL / port |
|---------|------------|
| App | [http://localhost:3001](http://localhost:3001) |
| Emulator UI | [http://localhost:4000](http://localhost:4000) |
| Firestore | `localhost:8080` |
| Auth | `localhost:9099` |
| Storage | `localhost:9199` |

On first boot the `web` service runs `bun install`, waits for the emulators, runs `bun run seed`, then `bun run dev`. The repo is bind-mounted, so edits on the host hot-reload inside the container.

**Emulator sign-in** (seeded officer account):

- Email: `shpe-officer@tamu.edu`
- Password: `testpassword`

Use the email/password form on the login page (not Google OAuth) while on the emulators.

Stop with `Ctrl+C`, or run detached with `docker compose up -d` / `docker compose down`.

### Scripts (host)

If you already have the emulators running and want to run the app on the host:

```bash
bun install
bun run seed   # seed emulator fixtures (idempotent)
bun run dev    # http://localhost:3000
bun run build
bun run start
bun run lint
```

Host runs expect the emulator host env vars from [`.env.development`](.env.development) (`FIRESTORE_EMULATOR_HOST=localhost:8080`, etc.).

### Tests

The `scripts/test-*.ts` suites are **emulator-only**. Bring the emulators up
(`docker compose up`), seed fixtures, then run any suite:

```bash
bun run seed                              # idempotent
bun run scripts/test-committees-route.ts  # one suite
```

Every suite that touches Firebase opens with `import "./lib/requireEmulator";`
as its **first** import. That guard fills in the local emulator hosts and
**hard-fails** if the resolved host is not a local address, so a test can never
read or write real chapter data. It must stay the first import: ES modules are
evaluated before the importing file's own statements, so a plain
`process.env.FIRESTORE_EMULATOR_HOST = ...` line would run too late to matter.

> **If you have a `.env.local`, tests still run against the emulator** — the
> guard treats its blank emulator hosts as unset. It is a **host** `bun run dev`
> that `.env.local` puts on production, so keep the two modes straight and move
> it aside (`mv .env.local .env.local.disabled`) when doing normal development.
>
> `docker compose up` is unaffected either way: the compose `environment:`
> block sets real process env vars, which take precedence over every `.env`
> file, so the container stays on the emulators even with `.env.local` present.

**Never point a test script at production.** They create and delete fixture
documents (`route-*` users, `memberSHPE/member-07`, throwaway committees and
events) on the assumption that the database is disposable. Against real data
they leave fabricated membership requests in the officers' queue.

### Run against production (local)

Point a **host** `bun run dev` at the real `tamushpemobileapp` project via gitignored [`.env.local`](.env.local). See [`.env.example`](.env.example) for the full template.

1. Copy the **Production-local** block from `.env.example` into `.env.local` (already scaffolded with placeholders if present).
2. Fill secrets from Firebase Console → project `tamushpemobileapp`:
   - `NEXT_PUBLIC_GOOGLE_API_KEY` — Project settings → Your apps → Web API key
   - `FIREBASE_SERVICE_ACCOUNT_KEY` — Project settings → Service accounts → Generate new private key → stringify to **one line** (keep `\n` escapes inside `private_key`)
3. Keep emulator overrides explicit in `.env.local` (required — omitting them leaves `.env.development` values in effect):
   - `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false`
   - `FIRESTORE_EMULATOR_HOST=` / `FIREBASE_AUTH_EMULATOR_HOST=` / `FIREBASE_STORAGE_EMULATOR_HOST=` (empty)
4. Stop `docker compose` (do not use Docker for this mode).
5. On the host: `bun install && bun run dev` → [http://localhost:3000](http://localhost:3000)
6. Sign in with Google `@tamu.edu` (the emulator email/password form does not apply). Your account needs a recognized custom claim (`admin` / `officer` / `developer`).

**Warning:** every write hits real chapter data.

This mode is for **manually verifying against production in the browser only**.
Do not run `bun run seed` or any `scripts/test-*.ts` while `.env.local` is in
place — seeding overwrites live committees and users with fixtures. The test
suites are guarded and will refuse to run against a non-local host; `seed` is
guarded the same way. Neither guard is a substitute for moving `.env.local`
aside when you are done.

**`next build` gotcha:** without emulator hosts set, `FIREBASE_SERVICE_ACCOUNT_KEY` must be a valid service-account JSON — Admin SDK initializes at import time for `/api/[[...route]]`.

**Convention tracking:** there is no need to pre-create a `convention-tracking` collection in the console. The first successful track (`POST /api/conventions/track`) creates `convention-tracking/{uid}` via the Admin SDK. An empty roster UI is expected until officers import/track members. Production Firestore **read** rules must allow officers to read `convention-tracking/{document=**}` (same claim gate as other admin reads); without that, the tracker UI fails even though track/untrack writes succeed.

## Tech Stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript**
- **Tailwind CSS** for styling
- **Firebase** (Auth, Firestore, Storage, Cloud Functions)
- **ExcelJS** for client-side points export

## Project Structure

```
app/
├── page.tsx              # Login
├── (main)/               # Authenticated pages (events, points, membership, …)
├── api/firebaseUtils.ts  # Client-side Firestore helpers (not HTTP routes)
├── config/               # Firebase initialization
├── helpers/              # Auth and utilities
└── types/                # Domain models (kept in sync with mobile app)
```

## Related Repositories

- **Mobile app** — shares Firestore collections and type definitions
- **Firebase Cloud Functions** — `updateAllUserPoints`, `sendNotificationMemberSHPE`, `zipResume` (not in this repo)

## Deployment

Hosted on Vercel. See [`cors.json`](cors.json) for allowed origins.
