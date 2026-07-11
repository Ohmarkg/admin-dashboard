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
 * error shape `{ error: { code, message } }`.
 */
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
        throw new Error(body.error?.message ?? `Request failed with status ${res.status}`);
    }

    return res;
}
