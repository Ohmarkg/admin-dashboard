export const runtime = "nodejs"; // REQUIRED — the Firebase Admin SDK cannot run on the Edge runtime

import { handle } from "hono/vercel";
import { app } from "@/server/app";

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
