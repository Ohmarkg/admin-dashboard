import { QueryClient } from "@tanstack/react-query";

/**
 * Factory for a QueryClient with sensible defaults for this app.
 * - staleTime: avoid refetching data that is "fresh enough" for an internal
 *   admin tool where near-real-time is not required.
 * - retry: 1 retry on failure (avoid hammering Firestore/Hono on hard failures).
 */
function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 60 * 1000,
                retry: 1,
            },
        },
    });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns a QueryClient instance.
 *
 * On the server, always creates a new client (so requests don't share state).
 * In the browser, creates a singleton so React strict mode's double-render
 * (and re-mounts) don't spin up a new client — and therefore a new cache —
 * on every render.
 */
export function getQueryClient() {
    const isServer = typeof window === "undefined";

    if (isServer) {
        return makeQueryClient();
    }

    if (!browserQueryClient) {
        browserQueryClient = makeQueryClient();
    }

    return browserQueryClient;
}
