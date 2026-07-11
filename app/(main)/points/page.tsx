"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import PageHeader from "@/components/PageHeader";
import BrandTabs from "@/components/BrandTabs";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/TableSkeleton";
import {
    usePointsData,
    useEditPoints,
    useRecalculatePoints,
    schoolYearMonthIndex,
    type PointsEdit,
} from "@/lib/hooks/usePoints";
import { useEvents } from "@/lib/hooks/useEvents";
import { TotalPointsTable, MonthlyPointsTable, parsePointsInput } from "./PointsGrid";
import { exportPointsWorkbook } from "./exportPoints";

// Points screen (V5 — DESIGN_BRIEF §4.3, prototype `screen_points`): a
// high-density spreadsheet for the SHPE school year. Total/Monthly tabs,
// inline cell editing (Monthly only — the Total column is a server-computed
// aggregate per DATA_MODEL invariant 4 and isn't directly editable, unlike
// the prototype's mock total-cell input), Save-all + Update Points actions.
// No manual reload button — mutations invalidate `['points']`/`['members']`.

type PtsView = "total" | "monthly";

export default function PointsPage() {
    const pointsQuery = usePointsData();
    const eventsQuery = useEvents();
    const editPoints = useEditPoints();
    const recalculate = useRecalculatePoints();

    const [ptsView, setPtsView] = React.useState<PtsView>("total");
    const [monthOverride, setMonthOverride] = React.useState<number | null>(null);
    // Raw in-progress cell values, keyed `${uid}:${eventId}`.
    const [edits, setEdits] = React.useState<Record<string, string>>({});
    const [isExporting, setIsExporting] = React.useState(false);

    const isLoading = pointsQuery.isLoading || eventsQuery.isLoading;
    const isError = pointsQuery.isError || eventsQuery.isError;

    const defaultMonthIndex = schoolYearMonthIndex(new Date()) ?? 0;
    const monthIndex = monthOverride ?? defaultMonthIndex;

    const events = eventsQuery.data ?? [];
    const months = pointsQuery.data?.months ?? [];
    const rows = pointsQuery.data?.rows ?? [];

    const selectedMonthDate = months[monthIndex];
    const monthEvents = React.useMemo(() => {
        if (!selectedMonthDate) return [];
        return events
            .filter((event) => event.name !== "Instagram Points" && event.startTime)
            .filter(
                (event) =>
                    schoolYearMonthIndex(event.startTime!.toDate()) === monthIndex
            )
            .sort(
                (a, b) => a.startTime!.toMillis() - b.startTime!.toMillis()
            );
    }, [events, monthIndex, selectedMonthDate]);

    const dirtyKeys = React.useMemo(
        () =>
            Object.keys(edits).filter((key) => {
                const [uid, eventId] = key.split(":");
                const row = rows.find((r) => r.uid === uid);
                const base = row?.eventLogs.find((l) => l.eventId === eventId)?.points ?? null;
                return parsePointsInput(edits[key]) !== base;
            }),
        [edits, rows]
    );
    const hasEdits = dirtyKeys.length > 0;

    function handleEditCell(uid: string, eventId: string, raw: string) {
        setEdits((prev) => ({ ...prev, [`${uid}:${eventId}`]: raw }));
    }

    function handleSave() {
        if (!hasEdits || editPoints.isPending) return;
        const payload: PointsEdit[] = dirtyKeys.map((key) => {
            const [uid, eventId] = key.split(":");
            return { uid, eventId, points: parsePointsInput(edits[key]) };
        });
        editPoints.mutate(payload, {
            onSuccess: () => {
                setEdits({});
                toast.success(
                    `Saved ${payload.length} ${payload.length === 1 ? "change" : "changes"}`
                );
            },
            onError: (error: unknown) => {
                toast.error(error instanceof Error ? error.message : "Failed to save changes");
            },
        });
    }

    async function handleExport() {
        if (isExporting || !pointsQuery.data) return;
        setIsExporting(true);
        try {
            await exportPointsWorkbook(pointsQuery.data, events);
            toast.success("Points workbook downloaded");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to export points");
        } finally {
            setIsExporting(false);
        }
    }

    function handleRecalculate() {
        if (recalculate.isPending) return;
        recalculate.mutate(undefined, {
            onSuccess: () => {
                toast.success("Points recalculated — totals in sync");
            },
            onError: (error: unknown) => {
                toast.error(
                    error instanceof Error ? error.message : "Failed to recalculate points"
                );
            },
        });
    }

    return (
        <div className="mx-auto max-w-[1240px] px-10 py-8">
            <PageHeader
                eyebrow="Points Spreadsheet"
                title="Points"
                actions={
                    <>
                        {hasEdits ? (
                            <span className="font-body text-xs font-semibold text-brand-light">
                                {dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? "edit" : "edits"}
                            </span>
                        ) : null}
                        <Button
                            onClick={handleSave}
                            disabled={!hasEdits || editPoints.isPending}
                        >
                            Save changes
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleRecalculate}
                            disabled={recalculate.isPending}
                        >
                            <RefreshCw
                                className={recalculate.isPending ? "animate-spin" : undefined}
                            />
                            {recalculate.isPending ? "Updating…" : "Update points"}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleExport}
                            disabled={isLoading || isExporting}
                        >
                            {isExporting ? "Exporting…" : "Export"}
                        </Button>
                    </>
                }
            />

            <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
                <BrandTabs
                    tabs={[
                        { value: "total", label: "Total Points" },
                        { value: "monthly", label: "Monthly Points" },
                    ]}
                    value={ptsView}
                    onValueChange={(value) => setPtsView(value as PtsView)}
                />

                {ptsView === "monthly" && months.length > 0 ? (
                    <Select
                        value={String(monthIndex)}
                        onValueChange={(value) => setMonthOverride(Number(value))}
                    >
                        <SelectTrigger className="w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {months.map((month, index) => (
                                <SelectItem key={index} value={String(index)}>
                                    {format(month, "MMMM yyyy")}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : null}
            </div>

            {isLoading ? (
                <TableSkeleton rows={8} columns={ptsView === "total" ? 14 : 6} />
            ) : isError ? (
                <ErrorState
                    message="We couldn't load the points spreadsheet. Please try again."
                    onRetry={() => {
                        pointsQuery.refetch();
                        eventsQuery.refetch();
                    }}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    title="No members yet"
                    message="Once members appear on the roster, their points will show up here."
                />
            ) : ptsView === "total" ? (
                <TotalPointsTable rows={rows} months={months} />
            ) : (
                <MonthlyPointsTable
                    rows={rows}
                    monthIndex={monthIndex}
                    monthEvents={monthEvents}
                    edits={edits}
                    onEditCell={handleEditCell}
                />
            )}
        </div>
    );
}
