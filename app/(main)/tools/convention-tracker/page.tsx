"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Search, Trash2, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmDialog from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { VerifiedBadge, NeutralBadge } from "@/components/Badges";
import DataTable from "@/components/DataTable";
import {
    useConventionTracking,
    useUntrackMember,
    REQUIRED_COUNT,
    type ConventionRow,
} from "@/lib/hooks/useConventionTracker";
import AddMembersDialog from "./AddMembersDialog";
import ImportDialog from "./ImportDialog";

// Convention Tracker screen: a searchable table of tracked members' National
// Convention eligibility (volunteering/workshops/general meetings attended
// out of REQUIRED_COUNT each). Reads from useConventionTracking() (client
// SDK); adds/removes go through the Hono `/api/conventions` routes.

function CountCell({ count }: { count: number }) {
    return (
        <span
            className={
                count >= REQUIRED_COUNT
                    ? "font-semibold tabular-nums text-[#15803D]"
                    : "font-semibold tabular-nums text-[#202020]"
            }
        >
            {count}/{REQUIRED_COUNT}
        </span>
    );
}

export default function ConventionTrackerPage() {
    const conventionQuery = useConventionTracking();
    const untrackMember = useUntrackMember();
    const [search, setSearch] = React.useState("");
    const [addOpen, setAddOpen] = React.useState(false);
    const [importOpen, setImportOpen] = React.useState(false);
    const [removeTarget, setRemoveTarget] = React.useState<ConventionRow | null>(null);

    const rows = conventionQuery.data ?? [];

    const trackedUids = React.useMemo(
        () => new Set(rows.map((row) => row.uid)),
        [rows]
    );

    const eligibleCount = rows.filter((row) => row.eligible).length;

    const filteredRows = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(
            (row) =>
                row.name.toLowerCase().includes(q) ||
                row.email.toLowerCase().includes(q)
        );
    }, [rows, search]);

    function handleRemove() {
        if (!removeTarget) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            untrackMember.mutate(removeTarget.uid, {
                onSuccess: () => {
                    toast.success(`Removed ${removeTarget.name} from tracking`);
                    resolve();
                },
                onError: (error: unknown) => {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : "Failed to remove member from tracking"
                    );
                    reject(error);
                },
            });
        });
    }

    const columns = React.useMemo(
        () => [
            {
                key: "name",
                header: "Name",
                render: (row: ConventionRow) => (
                    <div className="font-semibold text-[#202020]">{row.name}</div>
                ),
                width: "200px",
            },
            {
                key: "email",
                header: "Email",
                render: (row: ConventionRow) => (
                    <span className="text-[#707070]">{row.email}</span>
                ),
            },
            {
                key: "volunteer",
                header: "Volunteering",
                align: "center" as const,
                render: (row: ConventionRow) => <CountCell count={row.counts.volunteer} />,
                width: "120px",
            },
            {
                key: "workshop",
                header: "Workshops",
                align: "center" as const,
                render: (row: ConventionRow) => <CountCell count={row.counts.workshop} />,
                width: "120px",
            },
            {
                key: "generalMeeting",
                header: "General Meetings",
                align: "center" as const,
                render: (row: ConventionRow) => (
                    <CountCell count={row.counts.generalMeeting} />
                ),
                width: "150px",
            },
            {
                key: "eligible",
                header: "Status",
                align: "center" as const,
                render: (row: ConventionRow) =>
                    row.eligible ? (
                        <VerifiedBadge>Eligible</VerifiedBadge>
                    ) : (
                        <NeutralBadge>Not yet</NeutralBadge>
                    ),
                width: "120px",
            },
            {
                key: "remove",
                header: "Remove",
                align: "center" as const,
                render: (row: ConventionRow) => (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRemoveTarget(row)}
                        aria-label={`Remove ${row.name} from tracking`}
                    >
                        <Trash2 className="h-4 w-4 text-[#B91C1C]" />
                    </Button>
                ),
                width: "80px",
            },
        ],
        []
    );

    return (
        <div className="mx-auto max-w-[1240px] px-10 py-8">
            <PageHeader
                eyebrow="Tools"
                title="Convention Tracker"
                description="Track selected members' National Convention eligibility — volunteering, workshops, and general meetings attended out of 2 each."
                actions={
                    <Button asChild variant="outline" size="sm">
                        <Link href="/tools">
                            <ArrowLeft className="h-4 w-4" />
                            Back to Tools
                        </Link>
                    </Button>
                }
            />

            {conventionQuery.isLoading ? (
                <TableSkeleton rows={8} columns={7} />
            ) : conventionQuery.isError ? (
                <ErrorState
                    message="We couldn't load the convention tracker. Please try again."
                    onRetry={() => conventionQuery.refetch()}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    title="No members tracked yet"
                    message="Add members to start tracking their National Convention eligibility."
                    action={{ label: "Add members", onClick: () => setAddOpen(true) }}
                />
            ) : (
                <>
                    {/* Toolbar: search + count summary + actions */}
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
                                tracked ·{" "}
                                <span className="font-semibold text-[#202020]">
                                    {eligibleCount}
                                </span>{" "}
                                eligible
                            </span>
                            <Button size="sm" onClick={() => setAddOpen(true)}>
                                <UserPlus className="h-4 w-4" />
                                Add members
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setImportOpen(true)}
                            >
                                <Upload className="h-4 w-4" />
                                Import from file
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

            <AddMembersDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                trackedUids={trackedUids}
            />
            <ImportDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                trackedUids={trackedUids}
            />
            <ConfirmDialog
                open={removeTarget !== null}
                onOpenChange={(next) => {
                    if (!next) setRemoveTarget(null);
                }}
                title={`Remove ${removeTarget?.name ?? ""} from tracking?`}
                variant="destructive"
                confirmLabel="Remove"
                onConfirm={handleRemove}
            />
        </div>
    );
}
