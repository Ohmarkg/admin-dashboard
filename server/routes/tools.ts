/**
 * Tools routes (BUILD_PLAN T1) — /api/tools
 *
 * `POST /shirts/:uid/toggle` flips the `shirtPickedUp` flag on
 * `shirt-sizes/{uid}` (API.md tools table — decided as a Hono route since it
 * is a Firestore write; leaving it client-side would reopen client write
 * access to `shirt-sizes`).
 */

import { Hono } from "hono";
import { z } from "zod";
import { adminDb } from "@/server/firebaseAdmin";

const toggleBodySchema = z.object({
    shirtPickedUp: z.boolean(),
});

export const toolsRouter = new Hono();

toolsRouter.post("/shirts/:uid/toggle", async (c) => {
    const parsed = toggleBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json(
            {
                error: {
                    code: "validation_error",
                    message: "Invalid request body.",
                    details: parsed.error.issues,
                },
            },
            400
        );
    }

    const uid = c.req.param("uid");
    const shirtRef = adminDb.doc(`shirt-sizes/${uid}`);
    const shirtSnap = await shirtRef.get();
    if (!shirtSnap.exists) {
        return c.json(
            {
                error: {
                    code: "shirt_not_found",
                    message: `No shirt-sizes doc for uid ${uid}.`,
                },
            },
            404
        );
    }

    const { shirtPickedUp } = parsed.data;
    await shirtRef.set({ shirtPickedUp }, { merge: true });

    return c.json({ ok: true }, 200);
});
