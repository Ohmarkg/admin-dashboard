import { format } from "date-fns";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

import {
    REQUIRED_COUNT,
    type ConventionAttendedEvent,
    type ConventionRow,
} from "@/lib/hooks/useConventionTracker";

const BRAND_MAROON = "FF500000";
const ELIGIBLE_GREEN = "FFE2F0D9";
const NOT_YET_YELLOW = "FFFFF2CC";
const INCOMPLETE_YELLOW = "FFFFF2CC";

const CATEGORY_LABELS = [
    ["volunteer", "Volunteering"],
    ["workshop", "Workshops"],
    ["generalMeeting", "General Meetings"],
] as const;

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: BRAND_MAROON },
        };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
}

function formatEventName(event: ConventionAttendedEvent): string {
    return event.name?.trim() || "Untitled event";
}

function requirementsMet(row: ConventionRow): number {
    return (
        Math.min(row.counts.volunteer, REQUIRED_COUNT) +
        Math.min(row.counts.workshop, REQUIRED_COUNT) +
        Math.min(row.counts.generalMeeting, REQUIRED_COUNT)
    );
}

function buildSummarySheet(workbook: ExcelJS.Workbook, rows: ConventionRow[]) {
    const sheet = workbook.addWorksheet("Tracker");
    sheet.columns = [
        { header: "Name", key: "name", width: 26 },
        { header: "Email", key: "email", width: 34 },
        { header: "Membership", key: "membership", width: 18 },
        {
            header: `Volunteering (of ${REQUIRED_COUNT})`,
            key: "volunteer",
            width: 20,
        },
        { header: `Workshops (of ${REQUIRED_COUNT})`, key: "workshop", width: 18 },
        {
            header: `General Meetings (of ${REQUIRED_COUNT})`,
            key: "generalMeeting",
            width: 24,
        },
        {
            header: `Requirements Met (of ${REQUIRED_COUNT * CATEGORY_LABELS.length})`,
            key: "requirementsMet",
            width: 23,
        },
        { header: "Eligibility", key: "eligibility", width: 16 },
        { header: "Eligibility Source", key: "eligibilitySource", width: 30 },
        { header: "Date Added", key: "dateAdded", width: 16 },
    ];
    sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
    sheet.autoFilter = { from: "A1", to: "J1" };
    styleHeaderRow(sheet);

    rows.forEach((row) => {
        const excelRow = sheet.addRow({
            name: row.name,
            email: row.email,
            membership: row.isMemberVerified ? "Verified" : "Not verified",
            volunteer: row.counts.volunteer,
            workshop: row.counts.workshop,
            generalMeeting: row.counts.generalMeeting,
            requirementsMet: requirementsMet(row),
            eligibility: row.eligible ? "Eligible" : "Not yet eligible",
            eligibilitySource:
                row.eligibilityOverride === null
                    ? "Calculated from attendance"
                    : `Officer override (calculated: ${
                          row.calculatedEligible ? "eligible" : "not yet eligible"
                      })`,
            dateAdded: row.dateAdded.toDate(),
        });

        excelRow.getCell("dateAdded").numFmt = "mm/dd/yyyy";
        excelRow.getCell("eligibility").fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: row.eligible ? ELIGIBLE_GREEN : NOT_YET_YELLOW },
        };
        ["volunteer", "workshop", "generalMeeting"].forEach((key) => {
            const cell = excelRow.getCell(key);
            cell.alignment = { horizontal: "center" };
            if (Number(cell.value) >= REQUIRED_COUNT) {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: ELIGIBLE_GREEN },
                };
            }
        });
        excelRow.getCell("requirementsMet").alignment = { horizontal: "center" };
    });
}

function buildAttendanceDetailsSheet(workbook: ExcelJS.Workbook, rows: ConventionRow[]) {
    const sheet = workbook.addWorksheet("Attendance Details");
    sheet.columns = [
        { header: "Name", key: "name", width: 26 },
        { header: "Email", key: "email", width: 34 },
        { header: "Category", key: "category", width: 22 },
        { header: "Event", key: "event", width: 34 },
        { header: "Event Date", key: "eventDate", width: 16 },
        { header: "Attendance Record", key: "attendanceRecord", width: 34 },
    ];
    sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
    sheet.autoFilter = { from: "A1", to: "F1" };
    styleHeaderRow(sheet);

    rows.forEach((row) => {
        CATEGORY_LABELS.forEach(([key, label]) => {
            row.attendance[key].forEach((event) => {
                const excelRow = sheet.addRow({
                    name: row.name,
                    email: row.email,
                    category: label,
                    event: formatEventName(event),
                    eventDate: event.startTime?.toDate() ?? "Date unknown",
                    attendanceRecord: event.incomplete
                        ? "Incomplete — sign-in or sign-out only"
                        : "Complete",
                });

                if (event.startTime) {
                    excelRow.getCell("eventDate").numFmt = "mm/dd/yyyy";
                }
                if (event.incomplete) {
                    excelRow.getCell("attendanceRecord").fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: INCOMPLETE_YELLOW },
                    };
                }
            });
        });
    });
}

/** Builds the convention workbook without touching the browser download API. */
export function buildConventionTrackingWorkbook(rows: ConventionRow[]): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TAMU SHPE Admin Portal";
    workbook.title = "National Convention Tracker";
    workbook.subject = "National Convention eligibility and qualifying attendance";

    buildSummarySheet(workbook, rows);
    buildAttendanceDetailsSheet(workbook, rows);

    return workbook;
}

/** Downloads the current National Convention tracker as an Excel workbook. */
export async function exportConventionTrackingWorkbook(
    rows: ConventionRow[],
    now: Date = new Date()
): Promise<void> {
    const workbook = buildConventionTrackingWorkbook(rows);
    workbook.created = now;
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(
        new Blob([buffer]),
        `national-convention-tracker-${format(now, "yyyy-MM-dd")}.xlsx`
    );
}
