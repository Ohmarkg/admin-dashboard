import { collection, getDocs } from "firebase/firestore";
import { format } from "date-fns";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { saveAs } from "file-saver";

import { db } from "@/config/firebaseClient";
import type { EventWithId } from "@/lib/hooks/useEvents";
import {
    getCurrentSchoolYearMonths,
    getSchoolYearLabel,
    type MemberPublic,
} from "@/lib/hooks/usePoints";
import type { SHPEEventLog } from "@/types/events";
import type { PublicUserInfo } from "@/types/user";

// Client-side attendance Excel/ZIP export (API.md § "Excel export — decided:
// client-side, no route"). Ports the legacy dashboard export from
// tamu-shpe-admin-web/app/(main)/dashboard/page.tsx: per-event sheets plus a
// deduped "Unique Attendees" sheet for each month; school-year ZIP of monthly
// workbooks. Post-export summary/aggregation is handled offline by the Python
// scripts in scripts/.

const NA_VALUE = "NA";

type AttendeeRow = {
    name: string;
    major: string;
    classYear: string;
};

type EventLogForExport = SHPEEventLog & { uid: string };

export function buildUsersLookup(members: MemberPublic[]): Map<string, PublicUserInfo> {
    const lookup = new Map<string, PublicUserInfo>();
    for (const member of members) {
        const { uid, ...info } = member;
        lookup.set(uid, info);
    }
    return lookup;
}

export function getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}`;
}

function sanitizeWorksheetName(sheetName: string): string {
    const cleaned = sheetName.replace(/[\\/?*[\]:]/g, "-").trim();
    const truncated = cleaned.slice(0, 31);
    return truncated || "Sheet";
}

function getUniqueWorksheetName(workbook: ExcelJS.Workbook, requestedName: string): string {
    const baseName = sanitizeWorksheetName(requestedName);
    if (!workbook.getWorksheet(baseName)) {
        return baseName;
    }

    let counter = 1;
    while (true) {
        const suffix = `_${counter}`;
        const maxBaseLength = 31 - suffix.length;
        const candidate = `${baseName.slice(0, maxBaseLength)}${suffix}`;
        if (!workbook.getWorksheet(candidate)) {
            return candidate;
        }
        counter += 1;
    }
}

function isIncludedEvent(event: EventWithId, monthKeys: Set<string>): boolean {
    const startDate = event.startTime?.toDate();
    if (!startDate) return false;
    if (!monthKeys.has(getMonthKey(startDate))) return false;
    if (event.hiddenEvent === true) return false;

    const eventName = event.name?.toLowerCase() || "";
    return !eventName.includes("instagram points");
}

async function fetchEventLogsForExport(eventId: string): Promise<EventLogForExport[]> {
    const snapshot = await getDocs(collection(db, `events/${eventId}/logs`));
    return snapshot.docs.map((logDoc) => ({
        ...(logDoc.data() as SHPEEventLog),
        uid: logDoc.id,
    }));
}

async function buildMonthWorkbook(
    monthEvents: EventWithId[],
    usersLookup: Map<string, PublicUserInfo>
): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const uniqueAttendees = new Map<string, AttendeeRow>();

    const sortedEvents = [...monthEvents].sort((a, b) => {
        const aTime = a.startTime?.toDate().getTime() || 0;
        const bTime = b.startTime?.toDate().getTime() || 0;
        return aTime - bTime;
    });

    for (const event of sortedEvents) {
        const eventLogs = await fetchEventLogsForExport(event.id);
        const eventDateLabel = event.startTime
            ? format(event.startTime.toDate(), "MM-dd-yyyy")
            : "Unknown-Date";
        const eventName = event.name?.trim() || "Unnamed Event";
        const sheetName = getUniqueWorksheetName(workbook, `${eventName} ${eventDateLabel}`);
        const eventSheet = workbook.addWorksheet(sheetName);

        eventSheet.columns = [
            { header: "Name", key: "name", width: 30 },
            { header: "Major", key: "major", width: 30 },
            { header: "Class Year", key: "classYear", width: 15 },
        ];

        eventLogs.forEach((log, index) => {
            const publicUser = log.uid ? usersLookup.get(log.uid) : undefined;
            const row: AttendeeRow = {
                name: publicUser?.displayName || NA_VALUE,
                major: publicUser?.major || NA_VALUE,
                classYear: publicUser?.classYear || NA_VALUE,
            };

            eventSheet.addRow(row);

            const uniqueKey = log.uid
                ? `uid:${log.uid}`
                : `unknown:${event.id}:${index}:${row.name}:${row.classYear}:${row.major}`;
            if (!uniqueAttendees.has(uniqueKey)) {
                uniqueAttendees.set(uniqueKey, row);
            }
        });
    }

    const uniqueSheet = workbook.addWorksheet(getUniqueWorksheetName(workbook, "Unique Attendees"));
    uniqueSheet.columns = [
        { header: "Name", key: "name", width: 30 },
        { header: "Major", key: "major", width: 30 },
        { header: "Class Year", key: "classYear", width: 15 },
    ];

    Array.from(uniqueAttendees.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((row) => uniqueSheet.addRow(row));

    return workbook;
}

function groupEventsByMonth(
    events: EventWithId[],
    months: Date[]
): Map<string, EventWithId[]> {
    const monthKeys = new Set(months.map(getMonthKey));
    const filteredEvents = events.filter((event) => isIncludedEvent(event, monthKeys));
    const eventsByMonth = new Map<string, EventWithId[]>();

    months.forEach((month) => eventsByMonth.set(getMonthKey(month), []));
    filteredEvents.forEach((event) => {
        const startDate = event.startTime?.toDate();
        if (!startDate) return;
        const monthEvents = eventsByMonth.get(getMonthKey(startDate));
        if (monthEvents) {
            monthEvents.push(event);
        }
    });

    return eventsByMonth;
}

/** Downloads a ZIP of monthly attendance workbooks for the current school year. */
export async function exportSchoolYearAttendanceZip(
    events: EventWithId[],
    usersLookup: Map<string, PublicUserInfo>,
    now: Date = new Date()
): Promise<void> {
    const months = getCurrentSchoolYearMonths(now);
    const eventsByMonth = groupEventsByMonth(events, months);
    const zip = new JSZip();

    for (const month of months) {
        const monthEvents = eventsByMonth.get(getMonthKey(month)) || [];
        const workbook = await buildMonthWorkbook(monthEvents, usersLookup);
        const workbookBuffer = await workbook.xlsx.writeBuffer();
        zip.file(`attendance_${format(month, "yyyy_MM")}.xlsx`, workbookBuffer);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    saveAs(zipBlob, `attendance_${getSchoolYearLabel(now)}.zip`);
}

/** Downloads a single monthly attendance workbook for the selected month. */
export async function exportMonthAttendanceWorkbook(
    events: EventWithId[],
    usersLookup: Map<string, PublicUserInfo>,
    selectedMonth: Date
): Promise<void> {
    const monthKeys = new Set([getMonthKey(selectedMonth)]);
    const monthEvents = events.filter((event) => isIncludedEvent(event, monthKeys));
    const workbook = await buildMonthWorkbook(monthEvents, usersLookup);
    const workbookBuffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([workbookBuffer]), `attendance_${format(selectedMonth, "yyyy_MM")}.xlsx`);
}

/** School-year months (June–May) for UI month pickers. */
export function getAttendanceExportMonths(now: Date = new Date()): Date[] {
    return getCurrentSchoolYearMonths(now);
}

/** Default selected month key for the month picker (current calendar month if in range). */
export function getDefaultAttendanceMonthKey(now: Date = new Date()): string {
    const months = getAttendanceExportMonths(now);
    const defaultMonth =
        months.find((month) => getMonthKey(month) === getMonthKey(now)) || months[0];
    return getMonthKey(defaultMonth);
}
