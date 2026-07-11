"use client";

import { format } from "date-fns";

import FormDialog from "@/components/FormDialog";
import { EmptyState } from "@/components/EmptyState";

import { getEventColor } from "./EventChip";
import type { CalendarEvent } from "./EventCalendar";

export interface DayDrilldownModalProps<TRaw = unknown> {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The day being drilled into — null while closed/unset. */
    date: Date | null;
    /** Events for that day, already filtered by the caller. */
    events: CalendarEvent<TRaw>[];
    onEventClick?: (id: string) => void;
}

/**
 * Day drill-down modal (DESIGN_BRIEF §4.2, prototype "DAY MODAL"): lists a
 * single day's events with time/type/committee; clicking a row calls
 * `onEventClick`. Presentational only — the parent screen owns fetching the
 * day's events and open/close state.
 */
export default function DayDrilldownModal<TRaw = unknown>({
    open,
    onOpenChange,
    date,
    events,
    onEventClick,
}: DayDrilldownModalProps<TRaw>) {
    return (
        <FormDialog
            open={open}
            onOpenChange={onOpenChange}
            eyebrow="Events on"
            title={date ? format(date, "MMMM d, yyyy") : ""}
            className="max-w-md"
        >
            {events.length === 0 ? (
                <EmptyState
                    title="No events"
                    message="Nothing is scheduled for this day."
                />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {events.map((ev) => {
                        const color = getEventColor(ev.eventType);
                        return (
                            <button
                                key={ev.id}
                                type="button"
                                onClick={() => onEventClick?.(ev.id)}
                                style={{ borderLeftColor: color }}
                                className="rounded-sm border border-[#EAEAEA] border-l-[3px] bg-white px-[15px] py-3 text-left transition-colors hover:bg-[#FAFAF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7B7B7]"
                            >
                                <div className="font-sans text-[15px] font-semibold text-foreground">
                                    {ev.name}
                                </div>
                                <div className="mt-0.5 font-body text-xs text-[#707070]">
                                    {format(ev.startTime, "h:mm a")} –{" "}
                                    {format(ev.endTime, "h:mm a")}
                                    {ev.eventType ? <> · {ev.eventType}</> : null}
                                    {ev.committee ? <> · {ev.committee}</> : null}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </FormDialog>
    );
}
