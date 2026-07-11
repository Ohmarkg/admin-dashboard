import { EventType } from "@/types/events";

import { cn } from "@/components/lib/utils";

import type { CalendarEvent } from "./EventCalendar";

// Chip color by event type — mirrors the prototype's calendar sample data
// (`EVENTS` colors in `prototype/SHPE Admin Portal.dc.html`'s script): each
// event type reads as a distinct hue so the month grid is scannable at a
// glance. Callers that already know an event's committee color (e.g. once
// `useCommittees` is wired in E4/E5) can override via the `color` prop.
export const EVENT_TYPE_COLORS: Record<EventType, string> = {
    [EventType.GENERAL_MEETING]: "#500000",
    [EventType.COMMITTEE_MEETING]: "#2563EB",
    [EventType.STUDY_HOURS]: "#626262",
    [EventType.WORKSHOP]: "#7C3AED",
    [EventType.VOLUNTEER_EVENT]: "#15803D",
    [EventType.SOCIAL_EVENT]: "#0D9488",
    [EventType.INTRAMURAL_EVENT]: "#D97706",
    [EventType.CUSTOM_EVENT]: "#3E3E3E",
};

const FALLBACK_COLOR = "#707070";

/** Resolve a chip color: explicit override first, then the event-type map. */
export function getEventColor(
    eventType: EventType | null | undefined,
    override?: string | null
): string {
    if (override) return override;
    if (eventType && EVENT_TYPE_COLORS[eventType]) return EVENT_TYPE_COLORS[eventType];
    return FALLBACK_COLOR;
}

export interface EventChipProps<TRaw = unknown> {
    event: CalendarEvent<TRaw>;
    onClick?: (id: string) => void;
    /** Override the event-type color (e.g. with a resolved committee color). */
    color?: string | null;
    /**
     * "sm" — compact single-line chip for month grid cells.
     * "lg" — larger chip with a time line, for the week view / drilldown list.
     */
    size?: "sm" | "lg";
    /** Show a formatted time line (used by the "lg" size). */
    timeLabel?: string;
    className?: string;
}

/**
 * Compact colored chip representing a single calendar event. Color is
 * driven by event type (DESIGN_BRIEF §4.2 "colored chips"), with an
 * optional override for committee-color coding.
 */
export default function EventChip<TRaw = unknown>({
    event,
    onClick,
    color,
    size = "sm",
    timeLabel,
    className,
}: EventChipProps<TRaw>) {
    const resolvedColor = getEventColor(event.eventType, color ?? undefined);

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onClick?.(event.id);
            }}
            title={event.name}
            style={{ backgroundColor: resolvedColor }}
            className={cn(
                "block w-full truncate rounded-sm text-left font-body text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7B7B7]",
                size === "sm"
                    ? "mb-0.5 px-1.5 py-0.5 text-[10px] font-semibold"
                    : "mb-1 whitespace-normal px-2 py-1.5 text-[11px] font-semibold leading-tight",
                className
            )}
        >
            {event.name}
            {size === "lg" && timeLabel ? (
                <span className="block font-normal text-white/85">{timeLabel}</span>
            ) : null}
        </button>
    );
}
