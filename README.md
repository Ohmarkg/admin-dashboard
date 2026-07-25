# TAMU SHPE Admin Web

Internal admin portal for the Texas A&M SHPE chapter. Officers use this Next.js app to manage the same Firebase backend (`tamushpemobileapp`) as the chapter mobile app — events, membership verification, points, committees, and operational tools.

Access is restricted to `@tamu.edu` Google accounts with Firebase custom claims (`admin`, `officer`, `developer`, `lead`, or `representative`).

## Features

| Route | Purpose |
|-------|---------|
| `/dashboard` | Post-login landing (stub) |
| `/events` | Event calendar and pending attendance approvals |
| `/points` | School-year points ledger with edit, export, and recalculation |
| `/membership` | SHPE membership verification (approve/deny requests) |
| `/committees` | Read-only committee directory |
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
