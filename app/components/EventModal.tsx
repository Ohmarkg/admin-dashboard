"use client";

import * as React from "react";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";
import { CheckSquare } from "lucide-react";
import { toast } from "sonner";

import FormDialog from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TableSkeleton } from "@/components/TableSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";

import { EventType } from "@/types/events";
import type { WorkshopType } from "@/types/events";
import type { Committee } from "@/types/committees";
import {
    useCreateEvent,
    useUpdateEvent,
    useEventLogs,
    useApproveLog,
    useBulkApproveLogs,
    type EventWithId,
} from "@/lib/hooks/useEvents";

// --- datetime-local helpers -------------------------------------------------

function padTwo(n: number): string {
    return String(n).padStart(2, "0");
}

function toDatetimeLocal(ts: Timestamp | null | undefined): string {
    if (!ts) return "";
    const d = ts.toDate();
    return `${d.getFullYear()}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}T${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
}

function fromDatetimeLocal(s: string): Timestamp | null {
    if (!s) return null;
    return Timestamp.fromDate(new Date(s));
}

function toDatetimeLocalFromDate(d: Date): string {
    return `${d.getFullYear()}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}T${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
}

function nextHourDate(): Date {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
}

// --- form state -------------------------------------------------------------

interface EventFormState {
    name: string;
    description: string;
    eventType: EventType;
    startDateTime: string;
    endDateTime: string;
    startTimeBufferMin: string;
    endTimeBufferMin: string;
    locationName: string;
    lat: string;
    lng: string;
    geofencingRadius: string;
    committee: string;
    workshopType: WorkshopType;
    signInPoints: string;
    signOutPoints: string;
    pointsPerHour: string;
    general: boolean;
    hiddenEvent: boolean;
}

function defaultForm(): EventFormState {
    const start = nextHourDate();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
        name: "",
        description: "",
        eventType: EventType.GENERAL_MEETING,
        startDateTime: toDatetimeLocalFromDate(start),
        endDateTime: toDatetimeLocalFromDate(end),
        startTimeBufferMin: "0",
        endTimeBufferMin: "0",
        locationName: "",
        lat: "",
        lng: "",
        geofencingRadius: "",
        committee: "",
        workshopType: "None",
        signInPoints: "0",
        signOutPoints: "0",
        pointsPerHour: "0",
        general: true,
        hiddenEvent: false,
    };
}

function eventToForm(event: EventWithId): EventFormState {
    return {
        name: event.name ?? "",
        description: event.description ?? "",
        eventType: event.eventType ?? EventType.GENERAL_MEETING,
        startDateTime: toDatetimeLocal(event.startTime),
        endDateTime: toDatetimeLocal(event.endTime),
        startTimeBufferMin:
            event.startTimeBuffer != null ? String(event.startTimeBuffer / 60000) : "0",
        endTimeBufferMin:
            event.endTimeBuffer != null ? String(event.endTimeBuffer / 60000) : "0",
        locationName: event.locationName ?? "",
        lat: event.geolocation ? String(event.geolocation.latitude) : "",
        lng: event.geolocation ? String(event.geolocation.longitude) : "",
        geofencingRadius: event.geofencingRadius != null ? String(event.geofencingRadius) : "",
        committee: event.committee ?? "",
        workshopType: event.workshopType ?? "None",
        signInPoints: event.signInPoints != null ? String(event.signInPoints) : "0",
        signOutPoints: event.signOutPoints != null ? String(event.signOutPoints) : "0",
        pointsPerHour: event.pointsPerHour != null ? String(event.pointsPerHour) : "0",
        general: event.general ?? false,
        hiddenEvent: event.hiddenEvent ?? false,
    };
}

// --- component --------------------------------------------------------------

export interface EventModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** undefined/null = create mode; EventWithId = edit mode */
    event?: EventWithId | null;
    committees: Committee[];
}

export default function EventModal({ open, onOpenChange, event, committees }: EventModalProps) {
    const isEdit = Boolean(event);

    const [form, setForm] = React.useState<EventFormState>(() =>
        event ? eventToForm(event) : defaultForm()
    );

    React.useEffect(() => {
        if (open) {
            setForm(event ? eventToForm(event) : defaultForm());
        }
    }, [open, event]);

    const createEvent = useCreateEvent();
    const updateEvent = useUpdateEvent();
    const approveLog = useApproveLog();
    const bulkApprove = useBulkApproveLogs();

    const logsQuery = useEventLogs(event?.id ?? "");
    const logs = logsQuery.data ?? [];
    const unverifiedLogs = logs.filter((l) => l.verified !== true);

    function set<K extends keyof EventFormState>(key: K, value: EventFormState[K]) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    function buildPayload() {
        const lat = parseFloat(form.lat);
        const lng = parseFloat(form.lng);
        const radius = parseFloat(form.geofencingRadius);
        const startBufMs = parseFloat(form.startTimeBufferMin);
        const endBufMs = parseFloat(form.endTimeBufferMin);

        return {
            name: form.name.trim(),
            description: form.description.trim() || null,
            eventType: form.eventType,
            startTime: fromDatetimeLocal(form.startDateTime),
            endTime: fromDatetimeLocal(form.endDateTime),
            startTimeBuffer: isNaN(startBufMs) ? null : startBufMs * 60000,
            endTimeBuffer: isNaN(endBufMs) ? null : endBufMs * 60000,
            locationName: form.locationName.trim() || null,
            geolocation:
                !isNaN(lat) && !isNaN(lng) ? { latitude: lat, longitude: lng } : null,
            geofencingRadius: isNaN(radius) ? null : radius,
            committee: form.committee || null,
            workshopType:
                form.eventType === EventType.WORKSHOP ? form.workshopType : undefined,
            signInPoints: isNaN(parseFloat(form.signInPoints)) ? 0 : parseFloat(form.signInPoints),
            signOutPoints: isNaN(parseFloat(form.signOutPoints))
                ? 0
                : parseFloat(form.signOutPoints),
            pointsPerHour: isNaN(parseFloat(form.pointsPerHour))
                ? 0
                : parseFloat(form.pointsPerHour),
            general: form.general,
            hiddenEvent: form.hiddenEvent,
        };
    }

    function validate(): string | null {
        if (!form.name.trim()) return "Event name is required.";
        if (!form.startDateTime) return "Start time is required.";
        if (!form.endDateTime) return "End time is required.";
        if (new Date(form.endDateTime) <= new Date(form.startDateTime))
            return "End time must be after start time.";
        return null;
    }

    function handleSave() {
        const err = validate();
        if (err) {
            toast.error(err);
            return;
        }
        const input = buildPayload();

        if (isEdit && event) {
            updateEvent.mutate(
                { id: event.id, input },
                {
                    onSuccess: () => {
                        toast.success("Event updated");
                        onOpenChange(false);
                    },
                    onError: (e: unknown) =>
                        toast.error(e instanceof Error ? e.message : "Failed to update event"),
                }
            );
        } else {
            createEvent.mutate(input, {
                onSuccess: () => {
                    toast.success("Event created");
                    onOpenChange(false);
                },
                onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : "Failed to create event"),
            });
        }
    }

    function handleApproveRow(uid: string) {
        if (!event) return;
        approveLog.mutate(
            { eventId: event.id, uid },
            {
                onSuccess: () => toast.success("Attendee approved"),
                onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : "Failed to approve attendee"),
            }
        );
    }

    function handleBulkApprove() {
        if (!event || unverifiedLogs.length === 0) return;
        const uids = unverifiedLogs.map((l) => l.uid);
        bulkApprove.mutate(
            { eventId: event.id, uids },
            {
                onSuccess: () =>
                    toast.success(
                        `Approved ${uids.length} ${uids.length === 1 ? "attendee" : "attendees"}`
                    ),
                onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : "Failed to bulk approve"),
            }
        );
    }

    const isSaving = createEvent.isPending || updateEvent.isPending;

    return (
        <FormDialog
            open={open}
            onOpenChange={onOpenChange}
            eyebrow={isEdit ? "Edit Event" : "New Event"}
            title={isEdit ? (event?.name ?? "Edit Event") : "Create Event"}
            footer={
                <>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? "Saving…" : "Save event"}
                    </Button>
                </>
            }
        >
            <div className="space-y-6">
                <FormSection label="Basic Info">
                    <FieldRow>
                        <FormField label="Event Name *" id="ev-name">
                            <Input
                                id="ev-name"
                                value={form.name}
                                onChange={(e) => set("name", e.target.value)}
                                placeholder="e.g. Fall General Meeting"
                            />
                        </FormField>
                        <FormField label="Event Type" id="ev-type">
                            <Select
                                value={form.eventType}
                                onValueChange={(v) => set("eventType", v as EventType)}
                            >
                                <SelectTrigger id="ev-type">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.values(EventType).map((et) => (
                                        <SelectItem key={et} value={et}>
                                            {et}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormField>
                    </FieldRow>
                    <FormField label="Description" id="ev-desc">
                        <textarea
                            id="ev-desc"
                            value={form.description}
                            onChange={(e) => set("description", e.target.value)}
                            placeholder="Optional event description"
                            rows={3}
                            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                        />
                    </FormField>
                </FormSection>

                <FormSection label="Schedule">
                    <FieldRow>
                        <FormField label="Start Time *" id="ev-start">
                            <Input
                                id="ev-start"
                                type="datetime-local"
                                value={form.startDateTime}
                                onChange={(e) => set("startDateTime", e.target.value)}
                            />
                        </FormField>
                        <FormField label="End Time *" id="ev-end">
                            <Input
                                id="ev-end"
                                type="datetime-local"
                                value={form.endDateTime}
                                onChange={(e) => set("endDateTime", e.target.value)}
                            />
                        </FormField>
                    </FieldRow>
                    <FieldRow>
                        <FormField label="Sign-in Buffer (min)" id="ev-startbuf">
                            <Input
                                id="ev-startbuf"
                                type="number"
                                min={0}
                                value={form.startTimeBufferMin}
                                onChange={(e) => set("startTimeBufferMin", e.target.value)}
                            />
                        </FormField>
                        <FormField label="Sign-out Buffer (min)" id="ev-endbuf">
                            <Input
                                id="ev-endbuf"
                                type="number"
                                min={0}
                                value={form.endTimeBufferMin}
                                onChange={(e) => set("endTimeBufferMin", e.target.value)}
                            />
                        </FormField>
                    </FieldRow>
                </FormSection>

                <FormSection label="Location">
                    <FormField label="Location Name" id="ev-locname">
                        <Input
                            id="ev-locname"
                            value={form.locationName}
                            onChange={(e) => set("locationName", e.target.value)}
                            placeholder="e.g. ZACH 420"
                        />
                    </FormField>
                    <FieldRow>
                        <FormField label="Latitude" id="ev-lat">
                            <Input
                                id="ev-lat"
                                type="number"
                                step="any"
                                value={form.lat}
                                onChange={(e) => set("lat", e.target.value)}
                                placeholder="e.g. 30.618"
                            />
                        </FormField>
                        <FormField label="Longitude" id="ev-lng">
                            <Input
                                id="ev-lng"
                                type="number"
                                step="any"
                                value={form.lng}
                                onChange={(e) => set("lng", e.target.value)}
                                placeholder="e.g. -96.336"
                            />
                        </FormField>
                        <FormField label="Geofence Radius (m)" id="ev-radius">
                            <Input
                                id="ev-radius"
                                type="number"
                                min={0}
                                value={form.geofencingRadius}
                                onChange={(e) => set("geofencingRadius", e.target.value)}
                                placeholder="e.g. 100"
                            />
                        </FormField>
                    </FieldRow>
                </FormSection>

                <FormSection label="Points">
                    <FieldRow>
                        <FormField label="Sign-in Points" id="ev-signin">
                            <Input
                                id="ev-signin"
                                type="number"
                                min={0}
                                value={form.signInPoints}
                                onChange={(e) => set("signInPoints", e.target.value)}
                            />
                        </FormField>
                        <FormField label="Sign-out Points" id="ev-signout">
                            <Input
                                id="ev-signout"
                                type="number"
                                min={0}
                                value={form.signOutPoints}
                                onChange={(e) => set("signOutPoints", e.target.value)}
                            />
                        </FormField>
                        <FormField label="Points per Hour" id="ev-pph">
                            <Input
                                id="ev-pph"
                                type="number"
                                min={0}
                                step="0.5"
                                value={form.pointsPerHour}
                                onChange={(e) => set("pointsPerHour", e.target.value)}
                            />
                        </FormField>
                    </FieldRow>
                    {form.eventType === EventType.WORKSHOP ? (
                        <FormField label="Workshop Type" id="ev-workshop">
                            <Select
                                value={form.workshopType}
                                onValueChange={(v) => set("workshopType", v as WorkshopType)}
                            >
                                <SelectTrigger id="ev-workshop">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Professional">Professional</SelectItem>
                                    <SelectItem value="Academic">Academic</SelectItem>
                                    <SelectItem value="None">None</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormField>
                    ) : null}
                </FormSection>

                <FormSection label="Settings">
                    <FormField label="Committee" id="ev-committee">
                        <Select
                            value={form.committee || "__none__"}
                            onValueChange={(v) => set("committee", v === "__none__" ? "" : v)}
                        >
                            <SelectTrigger id="ev-committee">
                                <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">None</SelectItem>
                                {committees.map((c) => (
                                    <SelectItem
                                        key={c.firebaseDocName}
                                        value={c.firebaseDocName ?? ""}
                                    >
                                        {c.name ?? c.firebaseDocName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                    <div className="flex flex-wrap gap-6">
                        <CheckboxRow
                            id="ev-general"
                            label="Club-wide (General)"
                            checked={form.general}
                            onCheckedChange={(v) => set("general", Boolean(v))}
                        />
                        <CheckboxRow
                            id="ev-hidden"
                            label="Hidden event"
                            checked={form.hiddenEvent}
                            onCheckedChange={(v) => set("hiddenEvent", Boolean(v))}
                        />
                    </div>
                </FormSection>

                {isEdit && event ? (
                    <FormSection label="Attendee Log">
                        {logsQuery.isLoading ? (
                            <TableSkeleton rows={3} columns={5} />
                        ) : logsQuery.isError ? (
                            <ErrorState
                                message="Could not load attendee log."
                                onRetry={() => logsQuery.refetch()}
                            />
                        ) : logs.length === 0 ? (
                            <EmptyState
                                title="No sign-ins yet"
                                message="Attendee records will appear here after members sign in."
                            />
                        ) : (
                            <>
                                {unverifiedLogs.length > 0 ? (
                                    <div className="mb-3 flex justify-end">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={bulkApprove.isPending}
                                            onClick={handleBulkApprove}
                                        >
                                            <CheckSquare className="mr-1.5 h-4 w-4" />
                                            {bulkApprove.isPending
                                                ? "Approving…"
                                                : `Approve all unverified (${unverifiedLogs.length})`}
                                        </Button>
                                    </div>
                                ) : null}
                                <div className="overflow-hidden rounded-sm border border-[#EAEAEA] bg-white">
                                    <table className="w-full text-left text-sm">
                                        <thead>
                                            <tr className="border-b border-[#EAEAEA] bg-brand">
                                                <th className="px-3 py-2.5 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                                                    Member
                                                </th>
                                                <th className="px-3 py-2.5 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                                                    Points
                                                </th>
                                                <th className="px-3 py-2.5 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                                                    Sign In
                                                </th>
                                                <th className="px-3 py-2.5 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                                                    Sign Out
                                                </th>
                                                <th className="px-3 py-2.5 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                                                    Status
                                                </th>
                                                <th className="px-3 py-2.5" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {logs.map((log, i) => {
                                                const verified = log.verified === true;
                                                return (
                                                    <tr
                                                        key={log.uid}
                                                        className={
                                                            i % 2 === 1
                                                                ? "border-b border-[#F6F6F6] bg-[#FAFAF9]"
                                                                : "border-b border-[#F6F6F6] bg-white"
                                                        }
                                                    >
                                                        <td className="px-3 py-2 font-body text-sm font-semibold text-[#202020]">
                                                            {log.displayName || log.uid}
                                                        </td>
                                                        <td className="px-3 py-2 font-body tabular-nums text-[#3E3E3E]">
                                                            {log.points ?? "—"}
                                                        </td>
                                                        <td className="px-3 py-2 font-body text-xs tabular-nums text-[#707070]">
                                                            {log.signInTime
                                                                ? format(
                                                                      log.signInTime.toDate(),
                                                                      "MMM d, h:mm a"
                                                                  )
                                                                : "—"}
                                                        </td>
                                                        <td className="px-3 py-2 font-body text-xs tabular-nums text-[#707070]">
                                                            {log.signOutTime
                                                                ? format(
                                                                      log.signOutTime.toDate(),
                                                                      "MMM d, h:mm a"
                                                                  )
                                                                : "—"}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            {verified ? (
                                                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide text-green-800">
                                                                    Verified
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                                                    Pending
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            {!verified ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs"
                                                                    disabled={approveLog.isPending}
                                                                    onClick={() =>
                                                                        handleApproveRow(log.uid)
                                                                    }
                                                                >
                                                                    Approve
                                                                </Button>
                                                            ) : null}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </FormSection>
                ) : null}
            </div>
        </FormDialog>
    );
}

// --- layout helpers ---------------------------------------------------------

function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-3 border-b border-[#EAEAEA] pb-1 font-body text-[11px] font-bold uppercase tracking-[0.1em] text-[#A7A7A7]">
                {label}
            </div>
            <div className="space-y-3">{children}</div>
        </div>
    );
}

function FieldRow({ children }: { children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">{children}</div>
    );
}

function FormField({
    label,
    id,
    children,
}: {
    label: string;
    id: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label htmlFor={id} className="font-body text-xs font-semibold text-[#3E3E3E]">
                {label}
            </Label>
            {children}
        </div>
    );
}

function CheckboxRow({
    id,
    label,
    checked,
    onCheckedChange,
}: {
    id: string;
    label: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(v) => onCheckedChange(Boolean(v))}
            />
            <Label htmlFor={id} className="cursor-pointer font-body text-sm text-[#3E3E3E]">
                {label}
            </Label>
        </div>
    );
}
