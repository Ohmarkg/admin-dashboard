import { auth } from "@/config/firebaseClient";

// Shared fetch helper for Hono write routes under /api/*. Client-side only —
// reads never use this (CLAUDE.md rule 1); this is exclusively for
// useMutation calls in lib/hooks/*.

export interface ApiErrorBody {
    error?: {
        code?: string;
        message?: string;
        details?: unknown;
    };
}

/**
 * Calls a Hono route with the current user's Firebase ID token attached as a
 * Bearer credential (API.md Conventions § Auth). Throws a plain `Error` with
 * the server's `error.message` on any non-2xx response, per the standardized
 * error shape `{ error: { code, message, details? } }`. When `details` carries
 * zod issues, the offending fields are appended so a form-level failure names
 * the field the officer has to fix instead of just "Invalid request body."
 */
/**
 * Renders the zod issue array that routes put in `error.details` (API.md
 * Conventions § Request bodies) as `field: message` pairs. Returns undefined
 * for any other `details` payload — several routes send domain objects there
 * instead (e.g. `{ missingUids }`, `{ eventIds }`), which are not for display.
 */
function describeValidationIssues(details: unknown): string | undefined {
    if (!Array.isArray(details)) return undefined;

    const seen = new Set<string>();
    for (const issue of details) {
        if (!issue || typeof issue !== "object") continue;
        const { path, message } = issue as { path?: unknown; message?: unknown };
        if (typeof message !== "string" || !message) continue;
        const field = Array.isArray(path)
            ? path.filter((segment) => segment !== null && segment !== undefined).join(".")
            : "";
        seen.add(field ? `${field}: ${message}` : message);
    }

    return seen.size ? [...seen].join("; ") : undefined;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const user = auth.currentUser;
    if (!user) {
        throw new Error("Not authenticated.");
    }
    const token = await user.getIdToken();

    const res = await fetch(`/api${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...init.headers,
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const body: ApiErrorBody = await res.json().catch(() => ({}));
        const message = body.error?.message ?? `Request failed with status ${res.status}`;
        const issues = describeValidationIssues(body.error?.details);
        throw new Error(issues ? `${message} (${issues})` : message);
    }

    return res;
}
