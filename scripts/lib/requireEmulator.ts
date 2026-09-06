/**
 * Emulator guard for every script under `scripts/` that touches Firebase.
 *
 * ## Import this FIRST — before anything that reaches Firebase
 *
 *     import "./lib/requireEmulator";              // must be the first import
 *     import { adminDb } from "../server/firebaseAdmin";
 *
 * ES module imports are hoisted and evaluated before the importing module's
 * own statements, and in the source order of the import declarations. That is
 * why this is an imported module rather than a function you call: a top-level
 * `process.env.X = ...` statement runs *after* every static import has already
 * been evaluated, so `server/firebaseAdmin.ts` would have picked its backend
 * long before the assignment landed.
 *
 * ## Why this exists
 *
 * Scripts used to open with:
 *
 *     process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";
 *
 * That guard does not work, for two independent reasons:
 *
 *  1. **Hoisting** (above) — the assignment runs too late for static imports.
 *  2. **`??=` vs the empty string** — `.env.local` (the production-pointing
 *     override) sets `FIRESTORE_EMULATOR_HOST=` , i.e. the EMPTY STRING, and
 *     bun auto-loads it. `??=` only assigns on `null`/`undefined`, and `""` is
 *     neither, so the default was never applied.
 *
 * With both failures combined, `bun run scripts/test-*.ts` connected to
 * **production Firestore** using ambient gcloud credentials and wrote test
 * fixtures into real chapter data — silently, while printing PASS.
 *
 * `server/firebaseAdmin.ts` does not catch this on its own: its
 * "no credentials configured" throw sits behind an early
 * `if (getApps().length) return getApps()[0]`, so any script that calls
 * `initializeApp()` before importing it bypasses the check entirely.
 *
 * ## What this does
 *
 * Fills in the local emulator defaults when a host is unset *or empty*, and
 * **hard-fails** if a host resolves to anything that is not a local address.
 * There is no flag to override it: scripts in this repo are emulator-only by
 * design (CLAUDE.md, REBUILD_CONCEPT §9). To exercise production you need a
 * deliberate, separately written tool — not a test script that "PASS"es.
 */

export {}; // side-effect module — the empty export makes top-level await legal

const EMULATOR_DEFAULTS: Record<string, string> = {
    FIRESTORE_EMULATOR_HOST: "localhost:8080",
    FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099",
    FIREBASE_STORAGE_EMULATOR_HOST: "localhost:9199",
};

const LOOPBACK = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
    "host.docker.internal",
]);

/**
 * True for an address that can only be a local emulator.
 *
 * Two forms are accepted: an explicit loopback host, and a **bare hostname
 * with no dots** — which is what a container-network alias looks like
 * (docker-compose.yml points the web service at `emulators:8080`, and the
 * service could be renamed at any time). Google's Firestore/Auth endpoints are
 * always dotted FQDNs, so a dotless host cannot resolve to real infrastructure.
 */
function isEmulatorAddress(value: string): boolean {
    const split = value.lastIndexOf(":");
    if (split <= 0) return false; // must be host:port

    const host = value.slice(0, split);
    const port = value.slice(split + 1);
    if (!/^\d+$/.test(port)) return false;

    return LOOPBACK.has(host) || !host.includes(".");
}

function abort(lines: string[]): never {
    console.error(
        [
            "",
            "  ┌──────────────────────────────────────────────────────────────────┐",
            "  │  REFUSING TO RUN — this script is emulator-only                  │",
            "  └──────────────────────────────────────────────────────────────────┘",
            "",
            ...lines.map((line) => `  ${line}`),
            "",
            "  All development and testing runs against the Firebase Emulator",
            "  Suite in Docker. From the repo root:",
            "",
            "      docker compose up          # boots the emulators + bun run dev",
            "      bun run seed               # loads fixture data",
            "",
            "  If .env.local exists it points this machine at PRODUCTION and its",
            "  blank emulator hosts win over .env.development. Move it aside",
            "  before running any script on the host:",
            "",
            "      mv .env.local .env.local.disabled",
            "",
            "  Inside docker compose the emulator hosts come from the compose",
            "  environment block (emulators:8080), which overrides .env.local.",
            "",
        ].join("\n")
    );
    process.exit(1);
}

for (const [key, fallback] of Object.entries(EMULATOR_DEFAULTS)) {
    const current = process.env[key];

    // Truthiness, not `??` — `.env.local` sets these to "" rather than unsetting them.
    if (!current) {
        process.env[key] = fallback;
        continue;
    }

    if (!isEmulatorAddress(current.trim())) {
        abort([
            `${key} is set to "${current}", which is not a local emulator address.`,
            "That would send this script's reads and writes to real chapter data.",
        ]);
    }
}

// Reachability check: a local host that nothing is listening on means the
// emulators are not up. Failing here with an explanation beats a pile of
// opaque connection errors from deep inside the Admin SDK.
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST!;
try {
    await fetch(`http://${firestoreHost}/`, { signal: AbortSignal.timeout(3000) });
} catch {
    abort([
        `No Firestore emulator is listening on ${firestoreHost}.`,
        "The emulator suite does not appear to be running.",
    ]);
}

console.log(`[emulator] firestore=${firestoreHost} auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
