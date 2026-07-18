import { Hono } from "hono";
import { authMiddleware } from "@/server/middleware/auth";
import { pointsRouter } from "@/server/routes/points";
import { toolsRouter } from "@/server/routes/tools";
import { membershipRouter } from "@/server/routes/membership";
import { eventsRouter } from "@/server/routes/events";
import { conventionsRouter } from "@/server/routes/conventions";
import { instagramRouter } from "@/server/routes/instagram";

// The Hono app served from app/api/[[...route]]/route.ts (the only route.ts).
// Routers (membership/points/events/tools/conventions/instagram) are registered here as they are built.
export const app = new Hono().basePath("/api");

app.use("*", authMiddleware);

app.route("/points", pointsRouter);
app.route("/tools", toolsRouter);
app.route("/membership", membershipRouter);
app.route("/events", eventsRouter);
app.route("/conventions", conventionsRouter);
app.route("/instagram", instagramRouter);
