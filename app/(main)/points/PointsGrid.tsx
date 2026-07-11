"use client";

import * as React from "react";
import { format } from "date-fns";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { OfficerBadge } from "@/components/Badges";
import { cn } from "@/components/lib/utils";
import type { PointsRow } from "@/lib/hooks/usePoints";
import type { EventWithId } from "@/lib/hooks/useEvents";

// Supporting grid components for the Points screen (V5) — split out of
// page.tsx per the "Total Points" / "Monthly Points" tabs (DESIGN_BRIEF
// §4.3, prototype `totalRows`/`monthlyRows`). Kept presentational: all data
// fetching/mutation state lives in page.tsx.

/** Parses a raw cell input into the `PointsEdit.points` shape. Empty/blank
 * input clears the cell (null); anything non-numeric is treated as null too
 * (the input simply reverts visually once blurred elsewhere in the app). */
export function parsePointsInput(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
}

function officerRowClassName(row: PointsRow) {
    return row.isOfficer ? "bg-brand/[0.045]" : undefined;
}

function MemberCell({ row, rank }: { row: PointsRow; rank?: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            {rank != null ? (
                <span className="w-6 shrink-0 text-right font-display text-[15px] font-semibold text-[#A7A7A7]">
                    {rank}
                </span>
            ) : null}
            <span className="whitespace-nowrap text-[13.5px] font-semibold text-foreground">
                {row.displayName}
            </span>
            {row.isOfficer ? <OfficerBadge className="ml-1" /> : null}
        </div>
    );
}

function monthTotal(row: PointsRow, monthIndex: number): number {
    const bucket = row.months[monthIndex];
    if (!bucket) return 0;
    return bucket.points + bucket.instagramPoints;
}

// ---------------------------------------------------------------------------
// Total Points view
// ---------------------------------------------------------------------------

export function TotalPointsTable({
    rows,
    months,
}: {
    rows: PointsRow[];
    months: Date[];
}) {
    const columns = React.useMemo<DataTableColumn<PointsRow>[]>(() => {
        const cols: DataTableColumn<PointsRow>[] = [
            {
                key: "member",
                header: "Member",
                width: "220px",
                render: (row) => <MemberCell row={row} rank={row.pointsRank ?? "—"} />,
            },
            {
                key: "totalPoints",
                header: "Points",
                align: "right",
                width: "110px",
                className: "font-bold text-brand tabular-nums",
                render: (row) => row.totalPoints.toFixed(2),
            },
            ...months.map((month, index): DataTableColumn<PointsRow> => ({
                key: `month-${index}`,
                header: format(month, "MMM yyyy"),
                align: "right",
                width: "100px",
                render: (row) => {
                    const total = monthTotal(row, index);
                    return total !== 0 ? total.toFixed(2) : "";
                },
            })),
        ];
        return cols;
    }, [months]);

    return (
        <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.uid}
            frozenFirstColumn
            getRowClassName={officerRowClassName}
            maxHeight="60vh"
        />
    );
}

// ---------------------------------------------------------------------------
// Monthly Points view
// ---------------------------------------------------------------------------

export interface MonthlyEditCellProps {
    value: string;
    dirty: boolean;
    onChange: (raw: string) => void;
}

function EditableCell({ value, dirty, onChange }: MonthlyEditCellProps) {
    return (
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="numeric"
            className={cn(
                "w-16 rounded-sm border-none bg-transparent px-1.5 py-2 text-right font-body text-[13px] tabular-nums text-foreground outline-none",
                "focus:bg-white focus:shadow-[0_0_0_3px_#E7B7B7]",
                dirty && "bg-brand/[0.08] shadow-[inset_3px_0_0_#500000]"
            )}
        />
    );
}

export function MonthlyPointsTable({
    rows,
    monthIndex,
    monthEvents,
    edits,
    onEditCell,
}: {
    rows: PointsRow[];
    monthIndex: number;
    monthEvents: EventWithId[];
    /** Raw in-progress cell values, keyed `${uid}:${eventId}`. */
    edits: Record<string, string>;
    onEditCell: (uid: string, eventId: string, raw: string) => void;
}) {
    const columns = React.useMemo<DataTableColumn<PointsRow>[]>(() => {
        const cols: DataTableColumn<PointsRow>[] = [
            {
                key: "member",
                header: "Member",
                width: "200px",
                render: (row) => <MemberCell row={row} />,
            },
            ...monthEvents.map((event): DataTableColumn<PointsRow> => ({
                key: `event-${event.id}`,
                header: (
                    <div className="flex flex-col items-end gap-0.5">
                        <span className="whitespace-nowrap">{event.name ?? "Untitled event"}</span>
                        {event.startTime ? (
                            <span className="text-[9px] font-normal normal-case tracking-normal text-white/70">
                                {format(event.startTime.toDate(), "MM/dd/yyyy")}
                            </span>
                        ) : null}
                    </div>
                ),
                align: "right",
                width: "96px",
                render: (row) => {
                    const key = `${row.uid}:${event.id}`;
                    const log = row.eventLogs.find((l) => l.eventId === event.id);
                    const base = log?.points ?? null;
                    const rawValue = edits[key] ?? (base != null ? String(base) : "");
                    const dirty = key in edits && parsePointsInput(edits[key]) !== base;
                    return (
                        <EditableCell
                            value={rawValue}
                            dirty={dirty}
                            onChange={(raw) => onEditCell(row.uid, event.id, raw)}
                        />
                    );
                },
            })),
            {
                key: "instagram",
                header: "Instagram Points",
                align: "right",
                width: "110px",
                render: (row) => {
                    const value = row.months[monthIndex]?.instagramPoints ?? 0;
                    return value !== 0 ? value : "";
                },
            },
            {
                key: "total",
                header: "Total",
                align: "right",
                width: "100px",
                headerClassName: "bg-brand-dark",
                className: "bg-[#FAFAF7] font-bold text-brand tabular-nums",
                render: (row) => monthTotal(row, monthIndex).toFixed(2),
            },
        ];
        return cols;
    }, [monthEvents, monthIndex, edits, onEditCell]);

    return (
        <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.uid}
            frozenFirstColumn
            getRowClassName={officerRowClassName}
            maxHeight="60vh"
        />
    );
}
