// Pure, DOM/Firestore-free roster parsing for the Convention Tracker import
// dialog (built later): extracts member emails out of an uploaded CSV or
// .xlsx roster. No hooks, no Firebase — this module is a plain data
// transform so it can be unit-tested and reused by the (future) import UI.

/**
 * Hand-rolled CSV parser: handles quoted fields (`"a, b"`), escaped quotes
 * (`""`), CRLF/LF line endings, and skips fully-empty rows. Deliberately no
 * dependency — the roster CSVs here are small, simple exports (no embedded
 * newlines inside quoted fields need supporting beyond the common case).
 */
export function parseCsvText(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;

    const pushField = () => {
        row.push(field);
        field = "";
    };
    const pushRow = () => {
        pushField();
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ",") {
            pushField();
        } else if (char === "\r") {
            // ignore — the following \n (if present) drives the row break
        } else if (char === "\n") {
            pushRow();
        } else {
            field += char;
        }
    }

    // Flush a trailing field/row that wasn't terminated by a final newline.
    if (field !== "" || row.length > 0) pushRow();

    return rows;
}

/**
 * Reads an .xlsx/.xls roster's first worksheet into rows of stringified
 * cells, skipping fully-empty rows. `exceljs` is dynamically imported so it
 * stays out of the main bundle — exportPoints.ts (points Excel export)
 * imports it statically since that screen's Export button always needs it;
 * here we only need it on the (comparatively rare) roster-upload path, so a
 * dynamic import defers the cost until a file is actually chosen.
 */
export async function parseXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    const rows: string[][] = [];
    worksheet.eachRow((row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
            cells.push(cell.text ?? String(cell.value ?? ""));
        });
        if (cells.some((cell) => cell.trim() !== "")) rows.push(cells);
    });

    return rows;
}

const EMAIL_HEADER_RE = /e-?mail/i;

function looksLikeEmail(value: string): boolean {
    const at = value.indexOf("@");
    return at > 0 && value.indexOf(".", at) > at;
}

/**
 * Extracts member emails from parsed roster rows. Looks for a header cell
 * matching /e-?mail/i in the first non-empty row and takes that column from
 * every subsequent row; falls back to scanning every cell for `@`-looking
 * values if no such header is found. Normalizes (`trim().toLowerCase()`),
 * drops values that don't look like emails, and dedupes preserving order.
 */
export function extractEmails(rows: string[][]): string[] {
    const emails: string[] = [];
    const seen = new Set<string>();

    const addCandidate = (raw: string) => {
        const value = raw.trim().toLowerCase();
        if (!value || !looksLikeEmail(value) || seen.has(value)) return;
        seen.add(value);
        emails.push(value);
    };

    if (rows.length === 0) return emails;

    const [headerRow, ...dataRows] = rows;
    const emailColumnIndex = headerRow.findIndex((cell) => EMAIL_HEADER_RE.test(cell));

    if (emailColumnIndex !== -1) {
        for (const row of dataRows) {
            const cell = row[emailColumnIndex];
            if (cell) addCandidate(cell);
        }
        return emails;
    }

    // No recognizable header — scan every cell in every row for `@`-looking
    // values (matching happens against known member emails downstream, so
    // being lenient here is fine).
    for (const row of rows) {
        for (const cell of row) {
            if (cell) addCandidate(cell);
        }
    }

    return emails;
}

/** Structural subset of the browser `File` API — keeps this module testable outside the DOM. */
export interface RosterFileLike {
    name: string;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Convenience entry point for the (future) import dialog: dispatches on file
 * extension and returns the deduped list of extracted member emails.
 */
export async function parseRosterFile(file: RosterFileLike): Promise<string[]> {
    const name = file.name.toLowerCase();

    if (name.endsWith(".csv")) {
        const text = await file.text();
        return extractEmails(parseCsvText(text));
    }

    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buffer = await file.arrayBuffer();
        return extractEmails(await parseXlsxRows(buffer));
    }

    throw new Error("Unsupported roster file type — please upload a .csv or .xlsx file.");
}
