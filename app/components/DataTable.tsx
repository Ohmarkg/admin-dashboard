import * as React from "react"

import { cn } from "@/components/lib/utils"

/**
 * Column definition for DataTable. Generic over the row type so callers get
 * type-safe `render`/`key` access to their own row shape.
 */
export interface DataTableColumn<T> {
  /** Unique key for the column. If it matches a key of T, `render` is optional. */
  key: string
  header: React.ReactNode
  /** Custom cell renderer. Falls back to `String(row[key])` if omitted. */
  render?: (row: T, rowIndex: number) => React.ReactNode
  className?: string
  headerClassName?: string
  align?: "left" | "right" | "center"
  /** Column width, e.g. "60px" — useful for the frozen rank/name columns. */
  width?: string
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  /** Stable row key extractor. */
  getRowId: (row: T, rowIndex: number) => string
  /** First column sticks to the left edge as well as the header sticking to top (points grid). */
  frozenFirstColumn?: boolean
  /** Called per-row to add extra classes, e.g. maroon-tint officer rows. */
  getRowClassName?: (row: T, rowIndex: number) => string | undefined
  /** Fires on row click (optional — rows are otherwise inert). */
  onRowClick?: (row: T, rowIndex: number) => void
  className?: string
  /** Max height for the scroll container — table header/first column stick within it. */
  maxHeight?: string
}

const alignClass: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
}

/**
 * Headless-ish reusable table base (DESIGN_BRIEF §5): sticky header, zebra
 * striping, compact density, optional frozen first column, arbitrary cell
 * renderers, and a row-highlight hook. Plain React — no TanStack Table.
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  frozenFirstColumn = false,
  getRowClassName,
  onRowClick,
  className,
  maxHeight,
}: DataTableProps<T>) {
  return (
    <div
      className={cn(
        "relative w-full overflow-auto rounded-sm border border-[#EAEAEA] bg-white",
        className
      )}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse font-body text-sm">
        <thead>
          <tr>
            {columns.map((col, colIndex) => (
              <th
                key={col.key}
                className={cn(
                  "sticky top-0 z-20 whitespace-nowrap bg-brand px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white",
                  alignClass[col.align ?? "left"],
                  frozenFirstColumn && colIndex === 0 && "left-0 z-30",
                  col.headerClassName
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr
              key={getRowId(row, rowIndex)}
              onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
              className={cn(
                "border-b border-[#F6F6F6] transition-colors",
                rowIndex % 2 === 1 && "bg-[#FAFAF9]",
                onRowClick && "cursor-pointer hover:bg-muted/60",
                getRowClassName?.(row, rowIndex)
              )}
            >
              {columns.map((col, colIndex) => (
                <td
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap px-3.5 py-2.5 align-middle tabular-nums",
                    alignClass[col.align ?? "left"],
                    frozenFirstColumn &&
                      colIndex === 0 &&
                      "sticky left-0 z-10 bg-inherit",
                    col.className
                  )}
                >
                  {col.render
                    ? col.render(row, rowIndex)
                    : String((row as Record<string, unknown>)[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default DataTable
