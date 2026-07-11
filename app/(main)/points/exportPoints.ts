import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { format } from "date-fns";

import type { PointsData, PointsRow } from "@/lib/hooks/usePoints";
import { schoolYearMonthIndex } from "@/lib/hooks/usePoints";
import type { EventWithId } from "@/lib/hooks/useEvents";

// Client-side Excel export for the points screen (API.md § "Excel export —
// decided: client-side, no route"; BUILD_PLAN P1). Ports the structure of
// the legacy `exportPointsToExcel` (OLD-tamu-shpe-admin-web/app/(main)/points/page.tsx)
// onto the current PointsData/PointsRow shapes: a "Master" sheet (rank, name,
// email, total, per-month totals) plus one sheet per school-year month
// (member rows x that month's event columns + Instagram Points), mirroring
// the on-screen Total/Monthly grids.

const BRAND_MAROON = "FF500000";

/** Cycling pastel column colors, ported verbatim from the legacy export's `getColumnColor`. */
function getColumnColor(index: number): string {
    const colors = [
        "FFFFF9DB", // Light Yellow
        "FFDFF2D8", // Light Green
        "FFDDEEFF", // Light Blue
        "FFFAD4D4", // Light Red/Pink
        "FFE8DAEF", // Light Purple
        "FFFFD1DC", // Light Pink
        "FFFFE0B2", // Light Orange
        "FFD0EDE6", // Light Teal
        "FFD1C4E9", // Light Indigo
        "FFE0E0E0", // Light Gray
        "FFFFF7CC", // Slightly Darker Yellow
        "FFC8E6C9", // Slightly Darker Green
    ];
    return colors[index % colors.length];
}

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_MAROON } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
}

function monthTotal(row: PointsRow, monthIndex: number): number {
    const bucket = row.months[monthIndex];
    if (!bucket) return 0;
    return bucket.points + bucket.instagramPoints;
}

/** Builds the "Master" sheet: rank, name, email, total points, per-month totals. */
function buildMasterSheet(workbook: ExcelJS.Workbook, data: PointsData) {
    const sheet = workbook.addWorksheet("Master");

    sheet.columns = [
        { header: "Rank", key: "rank", width: 10 },
        { header: "Name", key: "name", width: 24 },
        { header: "Email", key: "email", width: 30 },
        { header: "Total Points", key: "totalPoints", width: 15 },
        ...data.months.map((month, index) => ({
            header: format(month, "MMM yyyy"),
            key: `month${index}`,
            width: 15,
        })),
    ];

    sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 4 }];
    styleHeaderRow(sheet);

    const sortedRows = [...data.rows].sort((a, b) => b.totalPoints - a.totalPoints);

    sortedRows.forEach((row, index) => {
        const rowValues: Record<string, string | number> = {
            rank: index + 1,
            name: row.displayName,
            email: row.email,
            totalPoints: row.totalPoints,
        };

        data.months.forEach((_month, monthIndex) => {
            const total = monthTotal(row, monthIndex);
            rowValues[`month${monthIndex}`] = total > 0 ? total : "";
        });

        const excelRow = sheet.addRow(rowValues);

        if (row.isOfficer) {
            excelRow.getCell("name").font = { color: { argb: "FFFF0000" }, bold: true };
        }

        data.months.forEach((_month, monthIndex) => {
            excelRow.getCell(`month${monthIndex}`).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: getColumnColor(monthIndex) },
            };
        });
    });
}

/** Builds one sheet per school-year month: member rows x that month's event columns + Instagram Points. */
function buildMonthlySheets(workbook: ExcelJS.Workbook, data: PointsData, events: EventWithId[]) {
    data.months.forEach((month, monthIndex) => {
        const monthName = format(month, "MMMM yyyy");
        const monthEvents = events
            .filter((event) => event.name !== "Instagram Points" && event.startTime)
            .filter((event) => schoolYearMonthIndex(event.startTime!.toDate()) === monthIndex)
            .sort((a, b) => a.startTime!.toMillis() - b.startTime!.toMillis());

        const sheet = workbook.addWorksheet(monthName);

        sheet.columns = [
            { header: "Rank", key: "rank", width: 10 },
            { header: "Name", key: "name", width: 24 },
            { header: "Email", key: "email", width: 30 },
            { header: "Monthly Points", key: "monthlyPoints", width: 15 },
            ...monthEvents.map((event, eventIndex) => ({
                header: `${event.name ?? "Untitled event"}\n${format(event.startTime!.toDate(), "MM/dd/yyyy")}`,
                key: `event${eventIndex}`,
                width: 20,
            })),
            { header: "Instagram Points", key: "instagramPoints", width: 15 },
        ];

        sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 4 }];
        styleHeaderRow(sheet);

        const sortedRows = [...data.rows].sort(
            (a, b) => monthTotal(b, monthIndex) - monthTotal(a, monthIndex)
        );

        sortedRows.forEach((row, index) => {
            const rowValues: Record<string, string | number> = {
                rank: index + 1,
                name: row.displayName,
                email: row.email,
                monthlyPoints: monthTotal(row, monthIndex) || 0,
            };

            monthEvents.forEach((event, eventIndex) => {
                const eventPoints = row.eventLogs.find((log) => log.eventId === event.id)?.points ?? 0;
                rowValues[`event${eventIndex}`] = eventPoints > 0 ? eventPoints : "";
            });

            const instagramPoints = row.months[monthIndex]?.instagramPoints ?? 0;
            rowValues.instagramPoints = instagramPoints > 0 ? instagramPoints : "";

            const excelRow = sheet.addRow(rowValues);

            if (row.isOfficer) {
                excelRow.getCell("name").font = { color: { argb: "FFFF0000" }, bold: true };
            }

            monthEvents.forEach((_event, eventIndex) => {
                excelRow.getCell(`event${eventIndex}`).fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: getColumnColor(eventIndex) },
                };
            });

            excelRow.getCell("instagramPoints").fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFFFF9DB" },
            };
        });
    });
}

/**
 * Builds and downloads the points spreadsheet as a multi-sheet .xlsx workbook
 * (Master + one sheet per school-year month), from data already held
 * client-side (API.md: "Excel export — decided: client-side, no route").
 *
 * `events` mirrors what the on-screen Monthly Points tab uses (`useEvents`)
 * to label each month sheet's event columns by name/date — `PointsData`
 * alone only carries `eventId`s on each row's raw `eventLogs`.
 */
export async function exportPointsWorkbook(data: PointsData, events: EventWithId[]): Promise<void> {
    const workbook = new ExcelJS.Workbook();

    buildMasterSheet(workbook, data);
    buildMonthlySheets(workbook, data, events);

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `SHPE-points-${data.schoolYearLabel}.xlsx`);
}
