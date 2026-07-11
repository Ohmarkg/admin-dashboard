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

### Prerequisites

- Node.js 18+
- A `@tamu.edu` Google account with an authorized Firebase custom claim
- `NEXT_PUBLIC_GOOGLE_API_KEY` set in `.env.local` (Firebase web API key)

### Install and run

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

### Scripts

```bash
yarn dev      # Start development server
yarn build    # Production build
yarn start    # Start production server
yarn lint     # Run ESLint
```

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
