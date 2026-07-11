"use client";

import * as React from "react";
import {
    addDays,
    addMonths,
    addWeeks,
    endOfMonth,
    endOfWeek,
    format,
    isSameMonth,
    isToday,
    startOfMonth,
    startOfWeek,
    subMonths,
    subWeeks,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { EventType } from "@/types/events";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/lib/utils";

import EventChip from "./EventChip";

// Lean, presentational event shape consumed by the calendar components.
// Callers (E4/E5) build this from the richer `SHPEEvent` / `useEvents` data —
// this component never touches Firebase/fetch (CLAUDE.md rule 8, DESIGN_BRIEF
// §4.2). `raw` optionally carries the original payload through for
// `onEventClick`/`onDayClick` handlers that need more than the lean shape.
export interface CalendarEvent<TRaw = unknown> {
    id: string;
    name: string;
    eventType: EventType;
    committee?: string | null;
    startTime: Date;
    endTime: Date;
    raw?: TRaw;
}

export type CalendarView = "month" | "week";

export interface EventCalendarProps<TRaw = unknown> {
    events: CalendarEvent<TRaw>[];
    onEventClick?: (id: string) => void;
    onDayClick?: (date: Date) => void;
    /** Optional "+ New event" affordance rendered in the calendar toolbar. */
    onCreateClick?: () => void;
    /** Initial month/week to display — defaults to today. */
    initialDate?: Date;
    /** Initial view — defaults to "month". */
    initialView?: CalendarView;
    className?: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Month/Week calendar grid (DESIGN_BRIEF §4.2, prototype Events screen).
 * date-fns month matrix, colored event chips, prev/next + today controls,
 * current-day highlight. Purely presentational — events arrive via props;
 * navigation (month/week cursor, view toggle) is local UI state.
 */
export default function EventCalendar<TRaw = unknown>({
    events,
    onEventClick,
    onDayClick,
    onCreateClick,
    initialDate,
    initialView = "month",
    className,
}: EventCalendarProps<TRaw>) {
    const [view, setView] = React.useState<CalendarView>(initialView);
    const [cursor, setCursor] = React.useState<Date>(initialDate ?? new Date());

    const eventsByDay = React.useMemo(() => {
        const map = new Map<string, CalendarEvent<TRaw>[]>();
        for (const event of events) {
            const key = format(event.startTime, "yyyy-MM-dd");
            const bucket = map.get(key);
            if (bucket) bucket.push(event);
            else map.set(key, [event]);
        }
        for (const bucket of map.values()) {
            bucket.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
        }
        return map;
    }, [events]);

    function eventsOn(day: Date): CalendarEvent<TRaw>[] {
        return eventsByDay.get(format(day, "yyyy-MM-dd")) ?? [];
    }

    function goPrev() {
        setCursor((d) => (view === "month" ? subMonths(d, 1) : subWeeks(d, 1)));
    }
    function goNext() {
        setCursor((d) => (view === "month" ? addMonths(d, 1) : addWeeks(d, 1)));
    }
    function goToday() {
        setCursor(new Date());
    }

    const monthMatrix = React.useMemo(() => {
        const monthStart = startOfMonth(cursor);
        const monthEnd = endOfMonth(cursor);
        const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
        const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

        const weeks: Date[][] = [];
        let day = gridStart;
        let week: Date[] = [];
        while (day <= gridEnd) {
            week.push(day);
            if (week.length === 7) {
                weeks.push(week);
                week = [];
            }
            day = addDays(day, 1);
        }
        return weeks;
    }, [cursor]);

    const weekDays = React.useMemo(() => {
        const weekStart = startOfWeek(cursor, { weekStartsOn: 0 });
        return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    }, [cursor]);

    const headerLabel =
        view === "month"
            ? format(cursor, "MMMM yyyy")
            : `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`;

    return (
        <div
            className={cn(
                "overflow-hidden rounded-sm border border-[#EAEAEA] bg-white",
                className
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EAEAEA] px-[18px] py-3.5">
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={goPrev}
                        aria-label={view === "month" ? "Previous month" : "Previous week"}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={goToday}
                    >
                        Today
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={goNext}
                        aria-label={view === "month" ? "Next month" : "Next week"}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <div className="ml-1 font-display text-xl font-semibold uppercase tracking-[0.02em] text-foreground">
                        {headerLabel}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {onCreateClick ? (
                        <Button type="button" size="sm" onClick={onCreateClick}>
                            + New event
                        </Button>
                    ) : null}
                    <div className="flex overflow-hidden rounded-sm border border-[#D1D1D1]">
                        <button
                            type="button"
                            onClick={() => setView("month")}
                            className={cn(
                                "px-3.5 py-1.5 font-body text-xs font-semibold",
                                view === "month"
                                    ? "bg-brand text-white"
                                    : "bg-white text-[#626262] hover:bg-[#F6F6F6]"
                            )}
                        >
                            Month
                        </button>
                        <button
                            type="button"
                            onClick={() => setView("week")}
                            className={cn(
                                "px-3.5 py-1.5 font-body text-xs font-semibold",
                                view === "week"
                                    ? "bg-brand text-white"
                                    : "bg-white text-[#626262] hover:bg-[#F6F6F6]"
                            )}
                        >
                            Week
                        </button>
                    </div>
                </div>
            </div>

            {view === "month" ? (
                <div>
                    <div className="grid grid-cols-7 border-b border-[#EAEAEA]">
                        {WEEKDAY_LABELS.map((w) => (
                            <div
                                key={w}
                                className="px-2.5 py-2 text-left font-body text-[10px] font-bold uppercase tracking-[.12em] text-[#A7A7A7]"
                            >
                                {w}
                            </div>
                        ))}
                    </div>
                    {monthMatrix.map((week, wi) => (
                        <div key={wi} className="grid grid-cols-7">
                            {week.map((day) => {
                                const dayEvents = eventsOn(day);
                                const inMonth = isSameMonth(day, cursor);
                                const today = isToday(day);
                                return (
                                    <div
                                        key={day.toISOString()}
                                        onClick={() => onDayClick?.(day)}
                                        className={cn(
                                            "min-h-[92px] border-b border-r border-[#F6F6F6] px-1.5 pb-1 pt-1.5 last:border-r-0",
                                            !inMonth && "bg-[#FAFAF7]",
                                            onDayClick && "cursor-pointer"
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "mb-1 flex h-5 w-5 items-center justify-center rounded-full font-body text-xs font-semibold tabular-nums text-[#707070]",
                                                !inMonth && "text-[#D1D1D1]",
                                                today && "bg-brand text-white"
                                            )}
                                        >
                                            {format(day, "d")}
                                        </div>
                                        {dayEvents.map((ev) => (
                                            <EventChip key={ev.id} event={ev} onClick={onEventClick} />
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-7">
                    {weekDays.map((day) => {
                        const dayEvents = eventsOn(day);
                        const today = isToday(day);
                        return (
                            <div
                                key={day.toISOString()}
                                onClick={() => onDayClick?.(day)}
                                className={cn(
                                    "min-h-[360px] border-r border-[#F6F6F6] px-2 py-2.5 last:border-r-0",
                                    onDayClick && "cursor-pointer"
                                )}
                            >
                                <div className="font-body text-[10px] font-bold uppercase tracking-[.1em] text-[#A7A7A7]">
                                    {format(day, "EEE")}
                                </div>
                                <div
                                    className={cn(
                                        "mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full font-display text-lg font-semibold text-[#3E3E3E]",
                                        today && "bg-brand text-white"
                                    )}
                                >
                                    {format(day, "d")}
                                </div>
                                {dayEvents.map((ev) => (
                                    <EventChip
                                        key={ev.id}
                                        event={ev}
                                        onClick={onEventClick}
                                        size="lg"
                                        timeLabel={format(ev.startTime, "h:mm a")}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
