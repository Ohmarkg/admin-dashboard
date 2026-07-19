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
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    useConventionTracking,
    useUntrackMember,
    REQUIRED_COUNT,
    type ConventionAttendedEvent,
    type ConventionRow,
} from "@/lib/hooks/useConventionTracker";
import AddMembersDialog from "./AddMembersDialog";
import ImportDialog from "./ImportDialog";

// Convention Tracker screen: a searchable table of tracked members' National
// Convention eligibility (volunteering/workshops/general meetings attended
// out of REQUIRED_COUNT each). Reads from useConventionTracking() (client
// SDK); adds/removes go through the Hono `/api/conventions` routes.

function formatEventDate(event: ConventionAttendedEvent) {
    if (!event.startTime) return "Date unknown";
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(event.startTime.toDate());
}

/**
 * A category count ("1/2") that opens a popover listing the qualifying
 * events behind the number (issue #14). `events` comes from the same
 * derivation as the count, so the list length always matches.
 */
function CountCell({
    memberName,
    categoryLabel,
    events,
}: {
    memberName: string;
    categoryLabel: string;
    events: ConventionAttendedEvent[];
}) {
    const count = events.length;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`${memberName}: ${count} of ${REQUIRED_COUNT} ${categoryLabel} attended — view events`}
                    className={`cursor-pointer rounded px-1.5 py-0.5 font-semibold tabular-nums underline decoration-dotted underline-offset-4 hover:bg-[#F4F4F4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#202020] ${
                        count >= REQUIRED_COUNT ? "text-[#15803D]" : "text-[#202020]"
                    }`}
                >
                    {count}/{REQUIRED_COUNT}
                </button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-80 p-3">
                <p className="mb-2 font-body text-xs font-semibold uppercase tracking-wide text-[#707070]">
                    {categoryLabel} · {memberName}
                </p>
                {events.length === 0 ? (
                    <p className="py-2 font-body text-sm text-muted-foreground">
                        No qualifying events yet
                    </p>
                ) : (
                    <ul className="divide-y divide-[#EAEAEA]">
                        {events.map((event, i) => (
                            <li
                                key={`${event.eventId}-${i}`}
                                className="flex items-baseline justify-between gap-3 py-1.5"
                            >
                                <span className="font-body text-sm font-medium text-[#202020]">
                                    {event.name || "Untitled event"}
                                </span>
                                <span className="shrink-0 font-body text-xs text-[#707070]">
                                    {formatEventDate(event)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </PopoverContent>
        </Popover>
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
                render: (row: ConventionRow) => (
                    <CountCell
                        memberName={row.name}
                        categoryLabel="Volunteering"
                        events={row.attendance.volunteer}
                    />
                ),
                width: "120px",
            },
            {
                key: "workshop",
                header: "Workshops",
                align: "center" as const,
                render: (row: ConventionRow) => (
                    <CountCell
                        memberName={row.name}
                        categoryLabel="Workshops"
                        events={row.attendance.workshop}
                    />
                ),
                width: "120px",
            },
            {
                key: "generalMeeting",
                header: "General Meetings",
                align: "center" as const,
                render: (row: ConventionRow) => (
                    <CountCell
                        memberName={row.name}
                        categoryLabel="General Meetings"
                        events={row.attendance.generalMeeting}
                    />
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
                description="Track selected members' National Convention eligibility — volunteering, workshops, and general meetings attended out of 2 each. Counts are based on attendance (sign-in and sign-out, by event type); the mobile app's per-event 'National Convention eligible' flag is not used."
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
