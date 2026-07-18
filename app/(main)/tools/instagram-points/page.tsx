"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Search, Star } from "lucide-react";
import { format } from "date-fns";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { VerifiedBadge, NeutralBadge } from "@/components/Badges";
import DataTable from "@/components/DataTable";
import {
    useInstagramPoints,
    type InstagramPointsRow,
} from "@/lib/hooks/useInstagramPoints";
import AwardPointsDialog from "./AwardPointsDialog";

// Instagram Points screen: a searchable table of members who have received
// Wear It Wednesday Instagram points (+1 per award), with award history.
// Reads from useInstagramPoints() (client SDK); awards go through the Hono
// `/api` routes via useAwardInstagramPoints() inside AwardPointsDialog. The
// hidden "Instagram Points" event is created lazily server-side on the first
// award — no manual setup required.

export default function InstagramPointsPage() {
    const instagramQuery = useInstagramPoints();
    const [search, setSearch] = React.useState("");
    const [awardOpen, setAwardOpen] = React.useState(false);

    const rows = instagramQuery.data?.rows ?? [];

    const awardCounts = React.useMemo(
        () => new Map(rows.map((row) => [row.uid, row.awardCount])),
        [rows]
    );

    const totalAwards = rows.reduce((sum, row) => sum + row.awardCount, 0);

    const filteredRows = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(
            (row) =>
                row.name.toLowerCase().includes(q) ||
                row.email.toLowerCase().includes(q)
        );
    }, [rows, search]);

    const columns = React.useMemo(
        () => [
            {
                key: "name",
                header: "Name",
                render: (row: InstagramPointsRow) => (
                    <div className="font-semibold text-[#202020]">{row.name}</div>
                ),
                width: "200px",
            },
            {
                key: "email",
                header: "Email",
                render: (row: InstagramPointsRow) => (
                    <span className="text-[#707070]">{row.email}</span>
                ),
            },
            {
                key: "awards",
                header: "Awards",
                align: "center" as const,
                render: (row: InstagramPointsRow) => (
                    <span className="font-semibold tabular-nums text-[#202020]">
                        {row.awardCount}
                    </span>
                ),
                width: "100px",
            },
            {
                key: "points",
                header: "Points",
                align: "center" as const,
                render: (row: InstagramPointsRow) => (
                    <span className="font-semibold tabular-nums text-[#202020]">
                        {row.points}
                    </span>
                ),
                width: "100px",
            },
            {
                key: "lastAwarded",
                header: "Last awarded",
                align: "center" as const,
                render: (row: InstagramPointsRow) => (
                    <span className="text-[#707070]">
                        {row.lastAwarded
                            ? format(row.lastAwarded.toDate(), "MMM d, yyyy")
                            : "—"}
                    </span>
                ),
                width: "140px",
            },
            {
                key: "status",
                header: "Status",
                align: "center" as const,
                render: (row: InstagramPointsRow) =>
                    row.isMemberVerified ? (
                        <VerifiedBadge>Verified</VerifiedBadge>
                    ) : (
                        <NeutralBadge>Not verified</NeutralBadge>
                    ),
                width: "120px",
            },
        ],
        []
    );

    return (
        <div className="mx-auto max-w-[1240px] px-10 py-8">
            <PageHeader
                eyebrow="Tools"
                title="Instagram Points"
                description="Award +1 point to members who posted for Wear It Wednesday on Instagram, and review award history."
                actions={
                    <Button asChild variant="outline" size="sm">
                        <Link href="/tools">
                            <ArrowLeft className="h-4 w-4" />
                            Back to Tools
                        </Link>
                    </Button>
                }
            />

            {instagramQuery.isLoading ? (
                <TableSkeleton rows={8} columns={6} />
            ) : instagramQuery.isError ? (
                <ErrorState
                    message="We couldn't load Instagram points. Please try again."
                    onRetry={() => instagramQuery.refetch()}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    title="No Instagram points awarded yet"
                    message="Award points to members who posted for Wear It Wednesday — everything is set up automatically on the first award."
                    action={{ label: "Award points", onClick: () => setAwardOpen(true) }}
                />
            ) : (
                <>
                    {/* Toolbar: search + summary + award action */}
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Search by name or email…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                            <span className="font-body text-sm text-[#626262]">
                                <span className="font-semibold text-[#202020]">
                                    {rows.length}
                                </span>{" "}
                                members ·{" "}
                                <span className="font-semibold text-[#202020]">
                                    {totalAwards}
                                </span>{" "}
                                awards
                            </span>
                            <Button size="sm" onClick={() => setAwardOpen(true)}>
                                <Star className="h-4 w-4" />
                                Award points
                            </Button>
                        </div>
                    </div>

                    {filteredRows.length === 0 ? (
                        <p className="py-8 text-center font-body text-sm text-muted-foreground">
                            No members match &ldquo;{search}&rdquo;
                        </p>
                    ) : (
                        <DataTable
                            columns={columns}
                            data={filteredRows}
                            getRowId={(row) => row.uid}
                            maxHeight="640px"
                        />
                    )}
                </>
            )}

            <AwardPointsDialog
                open={awardOpen}
                onOpenChange={setAwardOpen}
                awardCounts={awardCounts}
            />
        </div>
    );
}
