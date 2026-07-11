"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { VerifiedBadge, NeutralBadge } from "@/components/Badges";
import DataTable from "@/components/DataTable";
import { useShirts, useToggleShirt, type ShirtRow } from "@/lib/hooks/useTools";

// Shirt Tracker screen (DESIGN_BRIEF §4 "6a. Shirt Tracker"): a searchable
// table of shirt-size records with per-row pickup toggle. Reads from
// useShirts() (client SDK); writes via useToggleShirt() (Hono route).
// No manual reload button — invalidation fires on toggle success.

export default function ShirtTrackerPage() {
    const shirtsQuery = useShirts();
    const toggleShirt = useToggleShirt();
    const [search, setSearch] = React.useState("");

    const shirts = shirtsQuery.data ?? [];

    const pickedUpCount = shirts.filter((s) => s.shirtPickedUp).length;
    const remainingCount = shirts.length - pickedUpCount;

    const filteredShirts = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return shirts;
        return shirts.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.email.toLowerCase().includes(q)
        );
    }, [shirts, search]);

    function handleToggle(row: ShirtRow) {
        toggleShirt.mutate(
            { uid: row.uid, shirtPickedUp: !row.shirtPickedUp },
            {
                onSuccess: () => {
                    toast.success(
                        row.shirtPickedUp
                            ? `Marked ${row.name} as not picked up`
                            : `Marked ${row.name} as picked up`
                    );
                },
                onError: (error: unknown) => {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : "Failed to update pickup status"
                    );
                },
            }
        );
    }

    const columns = React.useMemo(
        () => [
            {
                key: "name",
                header: "Name",
                render: (row: ShirtRow) => (
                    <div>
                        <div className="font-semibold text-[#202020]">{row.name}</div>
                    </div>
                ),
                width: "220px",
            },
            {
                key: "email",
                header: "Email",
                render: (row: ShirtRow) => (
                    <span className="text-[#707070]">{row.email}</span>
                ),
            },
            {
                key: "isMemberVerified",
                header: "Membership",
                render: (row: ShirtRow) =>
                    row.isMemberVerified ? (
                        <VerifiedBadge />
                    ) : (
                        <NeutralBadge>Not verified</NeutralBadge>
                    ),
                width: "140px",
            },
            {
                key: "shirtSize",
                header: "Size",
                align: "center" as const,
                render: (row: ShirtRow) => (
                    <span className="font-semibold tabular-nums">{row.shirtSize}</span>
                ),
                width: "80px",
            },
            {
                key: "shirtPickedUp",
                header: "Picked up",
                align: "center" as const,
                render: (row: ShirtRow) => (
                    <Checkbox
                        checked={row.shirtPickedUp}
                        onCheckedChange={() => handleToggle(row)}
                        aria-label={`Mark ${row.name} as ${row.shirtPickedUp ? "not picked up" : "picked up"}`}
                        disabled={toggleShirt.isPending}
                    />
                ),
                width: "100px",
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [toggleShirt.isPending]
    );

    return (
        <div className="mx-auto max-w-[1240px] px-10 py-8">
            <PageHeader
                eyebrow="Tools"
                title="Shirt Tracker"
                description="Track shirt pickup for members who submitted a shirt size."
                actions={
                    <Button asChild variant="outline" size="sm">
                        <Link href="/tools">
                            <ArrowLeft className="h-4 w-4" />
                            Back to Tools
                        </Link>
                    </Button>
                }
            />

            {shirtsQuery.isLoading ? (
                <TableSkeleton rows={8} columns={5} />
            ) : shirtsQuery.isError ? (
                <ErrorState
                    message="We couldn't load the shirt tracker. Please try again."
                    onRetry={() => shirtsQuery.refetch()}
                />
            ) : shirts.length === 0 ? (
                <EmptyState
                    title="No shirt records"
                    message="No members have submitted a shirt size yet."
                />
            ) : (
                <>
                    {/* Toolbar: search + count summary */}
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
                        <span className="font-body text-sm text-[#626262]">
                            <span className="font-semibold text-[#202020]">{pickedUpCount}</span>{" "}
                            picked up ·{" "}
                            <span className="font-semibold text-[#202020]">{remainingCount}</span>{" "}
                            remaining
                        </span>
                    </div>

                    {filteredShirts.length === 0 ? (
                        <p className="py-8 text-center font-body text-sm text-muted-foreground">
                            No members match &ldquo;{search}&rdquo;
                        </p>
                    ) : (
                        <DataTable
                            columns={columns}
                            data={filteredShirts}
                            getRowId={(row) => row.uid}
                            maxHeight="640px"
                        />
                    )}
                </>
            )}
        </div>
    );
}
