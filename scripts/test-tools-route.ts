/**
 * Self-test for server/routes/tools.ts (BUILD_PLAN T1 acceptance criteria).
 *
 * Run with the emulators up: `bun run scripts/test-tools-route.ts`
 * Router is NOT yet registered in server/app.ts (orchestrator does that), so
 * this mounts `toolsRouter` on a scratch Hono app directly and exercises it
 * with `app.request(...)`.
 *
 * Verifies:
 *  1. Toggling seeded `shirt-sizes/member-02` flips the field (read back via
 *     the Admin SDK).
 *  2. A non-boolean `shirtPickedUp` body -> 400.
 *  3. An unknown uid -> 404.
 *
 * Restores the original field value on `shirt-sizes/member-02` afterward.
 */

process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";

import { Hono } from "hono";
import { toolsRouter } from "../server/routes/tools";
import { adminDb } from "../server/firebaseAdmin";

let failures = 0;

function pass(label: string) {
    console.log(`PASS: ${label}`);
}

function fail(label: string, detail?: unknown) {
    failures += 1;
    console.log(`FAIL: ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}

const app = new Hono();
app.route("/tools", toolsRouter);

const SEEDED_UID = "member-02";

async function testToggleFlips(): Promise<void> {
    const ref = adminDb.doc(`shirt-sizes/${SEEDED_UID}`);
    const before = await ref.get();
    if (!before.exists) {
        fail("seeded shirt-sizes/member-02 exists", "doc not found — is the emulator seeded?");
        return;
    }
    const originalValue = before.get("shirtPickedUp") as boolean;
    const toggledValue = !originalValue;

    try {
        const res = await app.request(`/tools/shirts/${SEEDED_UID}/toggle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shirtPickedUp: toggledValue }),
        });

        if (res.status !== 200) {
            fail("toggle seeded member-02 -> 200 ok", `got status ${res.status}`);
            return;
        }
        const body = await res.json();
        if (!body.ok) {
            fail("toggle seeded member-02 -> { ok: true }", `got body ${JSON.stringify(body)}`);
            return;
        }

        const after = await ref.get();
        if (after.get("shirtPickedUp") === toggledValue) {
            pass("toggle seeded member-02 -> shirtPickedUp field flips in Firestore");
        } else {
            fail(
                "toggle seeded member-02 -> shirtPickedUp field flips in Firestore",
                `expected ${toggledValue}, got ${after.get("shirtPickedUp")}`
            );
        }
    } finally {
        // Restore original value regardless of outcome.
        await ref.set({ shirtPickedUp: originalValue }, { merge: true });
    }
}

async function testNonBooleanBody(): Promise<void> {
    const res = await app.request(`/tools/shirts/${SEEDED_UID}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shirtPickedUp: "yes" }),
    });

    if (res.status === 400) {
        const body = await res.json();
        if (body?.error?.code) {
            pass("non-boolean shirtPickedUp body -> 400 with standard error shape");
        } else {
            fail("non-boolean shirtPickedUp body -> 400 with standard error shape", `got body ${JSON.stringify(body)}`);
        }
    } else {
        fail("non-boolean shirtPickedUp body -> 400", `got status ${res.status}`);
    }
}

async function testUnknownUid(): Promise<void> {
    const res = await app.request(`/tools/shirts/this-uid-does-not-exist/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shirtPickedUp: true }),
    });

    if (res.status === 404) {
        const body = await res.json();
        if (body?.error?.code === "shirt_not_found") {
            pass("unknown uid -> 404 { error: { code: 'shirt_not_found' } }");
        } else {
            fail("unknown uid -> 404 { error: { code: 'shirt_not_found' } }", `got body ${JSON.stringify(body)}`);
        }
    } else {
        fail("unknown uid -> 404", `got status ${res.status}`);
    }
}

async function main() {
    console.log("Running T1 tools-route self-tests against the emulator...\n");

    await testToggleFlips();
    await testNonBooleanBody();
    await testUnknownUid();

    console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    if (failures > 0) process.exit(1);
}

main().catch((err) => {
    console.error("Unhandled error in test run:", err);
    process.exit(1);
});
