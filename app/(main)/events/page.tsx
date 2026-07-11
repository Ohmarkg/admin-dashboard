"use client";

import * as React from "react";
import { format } from "date-fns";

import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import EventCalendar, { type CalendarEvent } from "@/components/calendar/EventCalendar";
import DayDrilldownModal from "@/components/calendar/DayDrilldownModal";
import EventModal from "@/components/EventModal";

import { EventType } from "@/types/events";
import { useEvents, usePendingEvents, type EventWithId } from "@/lib/hooks/useEvents";
import { useCommittees } from "@/lib/hooks/useCommittees";

export default function EventsPage() {
    const eventsQuery = useEvents();
    const pendingQuery = usePendingEvents();
    const committeesQuery = useCommittees();

    const events = eventsQuery.data ?? [];
    const committees = committeesQuery.data ?? [];

    const calendarEvents = React.useMemo<CalendarEvent<EventWithId>[]>(
        () =>
            events
                .filter((e) => e.startTime && e.endTime)
                .map((e) => ({
                    id: e.id,
                    name: e.name ?? "(untitled)",
                    eventType: (e.eventType ?? EventType.CUSTOM_EVENT) as EventType,
                    committee: e.committee,
                    startTime: e.startTime!.toDate(),
                    endTime: e.endTime!.toDate(),
                    raw: e,
                })),
        [events]
    );

    // create/edit modal state
    const [modalOpen, setModalOpen] = React.useState(false);
    const [editTarget, setEditTarget] = React.useState<EventWithId | null>(null);

    function openCreate() {
        setEditTarget(null);
        setModalOpen(true);
    }

    function openEdit(eventId: string) {
        const found = events.find((e) => e.id === eventId) ?? null;
        setEditTarget(found);
        setModalOpen(true);
    }

    // day drilldown state
    const [drillOpen, setDrillOpen] = React.useState(false);
    const [drillDate, setDrillDate] = React.useState<Date | null>(null);

    const drillEvents = React.useMemo(() => {
        if (!drillDate) return [];
        const key = format(drillDate, "yyyy-MM-dd");
        return calendarEvents.filter((e) => format(e.startTime, "yyyy-MM-dd") === key);
    }, [calendarEvents, drillDate]);

    function openDrilldown(date: Date) {
        setDrillDate(date);
        setDrillOpen(true);
    }

    function handleDrillEventClick(id: string) {
        setDrillOpen(false);
        openEdit(id);
    }

    return (
        <div className="mx-auto max-w-[1240px] px-10 py-8">
            <PageHeader eyebrow="Calendar & Attendance" title="Events" />

            {eventsQuery.isLoading ? (
                <Skeleton className="h-[520px] w-full rounded-sm" />
            ) : eventsQuery.isError ? (
                <ErrorState
                    message="We couldn't load events. Please try again."
                    onRetry={() => eventsQuery.refetch()}
                />
            ) : (
                <EventCalendar
                    events={calendarEvents}
                    onEventClick={openEdit}
                    onDayClick={openDrilldown}
                    onCreateClick={openCreate}
                />
            )}

            {/* Pending Approval */}
            <div className="mt-10">
                <h2 className="mb-4 font-display text-xl font-semibold uppercase tracking-[0.02em] text-foreground">
                    Pending Approval
                </h2>

                {pendingQuery.isLoading ? (
                    <TableSkeleton rows={3} columns={4} showHeader={false} />
                ) : pendingQuery.isError ? (
                    <ErrorState
                        message="We couldn't load pending events."
                        onRetry={() => pendingQuery.refetch()}
                    />
                ) : !pendingQuery.data || pendingQuery.data.length === 0 ? (
                    <p className="font-serif text-[15px] italic text-[#707070]">
                        No events need approval right now.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {pendingQuery.data.map((pending) => (
                            <PendingEventCard
                                key={pending.id}
                                name={pending.name}
                                startTime={pending.startTime ? pending.startTime.toDate() : null}
                                unverifiedCount={pending.unverifiedLogs.length}
                                onReview={() => openEdit(pending.id)}
                            />
                        ))}
                    </div>
                )}
            </div>

            <DayDrilldownModal
                open={drillOpen}
                onOpenChange={setDrillOpen}
                date={drillDate}
                events={drillEvents}
                onEventClick={handleDrillEventClick}
            />

            <EventModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                event={editTarget}
                committees={committees}
            />
        </div>
    );
}

function PendingEventCard({
    name,
    startTime,
    unverifiedCount,
    onReview,
}: {
    name: string;
    startTime: Date | null;
    unverifiedCount: number;
    onReview: () => void;
}) {
    return (
        <div className="flex flex-col gap-3 rounded-sm border border-[#EAEAEA] bg-white px-4 py-4">
            <div>
                <div className="font-body text-sm font-semibold text-[#202020]">{name}</div>
                {startTime ? (
                    <div className="mt-0.5 font-body text-xs text-[#A7A7A7]">
                        {format(startTime, "MMM d, yyyy · h:mm a")}
                    </div>
                ) : null}
            </div>
            <div className="flex items-center justify-between">
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide text-amber-800">
                    {unverifiedCount} pending
                </span>
                <button
                    type="button"
                    onClick={onReview}
                    className="font-body text-xs font-semibold text-brand underline-offset-2 hover:underline"
                >
                    Review →
                </button>
            </div>
        </div>
    );
}
