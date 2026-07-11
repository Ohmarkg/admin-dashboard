"use client";

import * as React from "react";
import Link from "next/link";

import PageHeader from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { OfficerBadge } from "@/components/Badges";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Card,
    CardHeader,
    CardTitle,
    CardContent,
} from "@/components/ui/card";

import { useMembershipRequests, useOfficialMembers } from "@/lib/hooks/useMembership";
import { usePendingEvents } from "@/lib/hooks/useEvents";
import { useMembers } from "@/lib/hooks/usePoints";

// Dashboard — post-login landing page (DESIGN_BRIEF §4 "1. Dashboard").
// Triage launchpad: 4 stat tiles + recent membership requests + points
// leaderboard preview. All data sourced from existing TanStack Query hooks;
// no Firebase/fetch calls on this page (CLAUDE.md rule 8).

export default function DashboardPage() {
    const requestsQuery = useMembershipRequests();
    const pendingEventsQuery = usePendingEvents();
    // "Total active members" → verified-only count via useOfficialMembers
    // (isMemberVerified filter), not the full roster from useMembers.
    const officialMembersQuery = useOfficialMembers();
    // Leaderboard uses useMembers() — already ordered by points desc.
    const membersQuery = useMembers();

    const pendingRequests = requestsQuery.data ?? [];
    const pendingEvents = pendingEventsQuery.data ?? [];
    const officialMembers = officialMembersQuery.data ?? [];
    const members = membersQuery.data ?? [];

    const recentRequests = pendingRequests.slice(0, 5);
    const topMembers = members.slice(0, 5);

    return (
        <div className="mx-auto max-w-[1240px] px-10 py-8">
            <PageHeader
                eyebrow="Chapter Operations"
                title="Dashboard"
                description="Good morning, Officers — here's the latest."
            />

            {/* ── Stat tiles ─────────────────────────────────────────────── */}
            <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile
                    eyebrow="Membership"
                    value={
                        requestsQuery.isLoading
                            ? "—"
                            : requestsQuery.isError
                              ? "!"
                              : pendingRequests.length
                    }
                    label="Pending Requests"
                    hint={requestsQuery.isError ? "Could not load" : undefined}
                    href="/membership"
                />
                <StatTile
                    eyebrow="Events"
                    value={
                        pendingEventsQuery.isLoading
                            ? "—"
                            : pendingEventsQuery.isError
                              ? "!"
                              : pendingEvents.length
                    }
                    label="Needing Approval"
                    hint={pendingEventsQuery.isError ? "Could not load" : undefined}
                    href="/events"
                />
                <StatTile
                    eyebrow="Roster"
                    value={
                        officialMembersQuery.isLoading
                            ? "—"
                            : officialMembersQuery.isError
                              ? "!"
                              : officialMembers.length
                    }
                    label="Active Members"
                    hint={officialMembersQuery.isError ? "Could not load" : undefined}
                    href="/membership"
                />
                {/* No persisted last-recalculated-at timestamp exists in the
                    data model, so this tile is static this session. */}
                <StatTile
                    eyebrow="Points"
                    value="—"
                    label="Recalculation Status"
                    hint="Not yet recalculated this session"
                    href="/points"
                />
            </div>

            {/* ── Cards row ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Recent membership requests */}
                <Card className="rounded-sm border-[#EAEAEA]">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="font-display text-base font-semibold uppercase tracking-wide text-foreground">
                                Recent Requests
                            </CardTitle>
                            <Link
                                href="/membership"
                                className="font-body text-xs font-semibold uppercase tracking-[.12em] text-brand hover:underline"
                            >
                                Review all →
                            </Link>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {requestsQuery.isLoading ? (
                            <div className="flex flex-col gap-3">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <Skeleton key={i} className="h-8 w-full" />
                                ))}
                            </div>
                        ) : requestsQuery.isError ? (
                            <ErrorState
                                message="Could not load membership requests."
                                onRetry={() => requestsQuery.refetch()}
                            />
                        ) : recentRequests.length === 0 ? (
                            <EmptyState
                                title="No pending requests"
                                message="All membership requests have been reviewed."
                                className="py-8"
                            />
                        ) : (
                            <ul className="divide-y divide-[#F0F0F0]">
                                {recentRequests.map((req) => (
                                    <li
                                        key={req.uid}
                                        className="flex items-center justify-between py-2.5"
                                    >
                                        <span className="font-body text-sm font-medium text-foreground">
                                            {req.name || req.uid}
                                        </span>
                                        <Link
                                            href="/membership"
                                            className="font-body text-xs font-semibold uppercase tracking-[.12em] text-brand hover:underline"
                                        >
                                            Review
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                {/* Points leaderboard preview */}
                <Card className="rounded-sm border-[#EAEAEA]">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="font-display text-base font-semibold uppercase tracking-wide text-foreground">
                                Points Leaderboard
                            </CardTitle>
                            <Link
                                href="/points"
                                className="font-body text-xs font-semibold uppercase tracking-[.12em] text-brand hover:underline"
                            >
                                View full spreadsheet →
                            </Link>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {membersQuery.isLoading ? (
                            <div className="flex flex-col gap-3">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Skeleton key={i} className="h-8 w-full" />
                                ))}
                            </div>
                        ) : membersQuery.isError ? (
                            <ErrorState
                                message="Could not load members roster."
                                onRetry={() => membersQuery.refetch()}
                            />
                        ) : topMembers.length === 0 ? (
                            <EmptyState
                                title="No members yet"
                                message="Once members appear on the roster, the leaderboard will populate here."
                                className="py-8"
                            />
                        ) : (
                            <ul className="divide-y divide-[#F0F0F0]">
                                {topMembers.map((member, index) => (
                                    <li
                                        key={member.uid}
                                        className="flex items-center gap-3 py-2.5"
                                    >
                                        <span className="w-5 shrink-0 font-display text-sm font-semibold tabular-nums text-brand">
                                            {index + 1}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate font-body text-sm font-medium text-foreground">
                                            {member.displayName ?? member.name ?? member.uid}
                                        </span>
                                        {member.roles?.officer ? (
                                            <OfficerBadge />
                                        ) : null}
                                        <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-brand">
                                            {member.points ?? 0}
                                            <span className="ml-1 font-body text-xs font-normal text-muted-foreground">
                                                pts
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
