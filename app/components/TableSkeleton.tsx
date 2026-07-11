import * as React from "react"

import { cn } from "@/components/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

export interface TableSkeletonProps {
  /** Number of skeleton rows to render. */
  rows?: number
  /** Number of skeleton columns per row. */
  columns?: number
  /** Render a skeleton header row above the body rows. */
  showHeader?: boolean
  className?: string
}

/**
 * Skeleton loader for table-shaped content (DESIGN_BRIEF §7.5) — used while
 * a DataTable's data is loading.
 */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  showHeader = true,
  className,
}: TableSkeletonProps) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-sm border border-[#EAEAEA] bg-white",
        className
      )}
    >
      {showHeader ? (
        <div className="flex items-center gap-4 border-b border-[#EAEAEA] bg-brand px-3.5 py-3">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1 bg-white/25" />
          ))}
        </div>
      ) : null}
      <div>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className={cn(
              "flex items-center gap-4 border-b border-[#F6F6F6] px-3.5 py-3",
              rowIndex % 2 === 1 && "bg-[#FAFAF9]"
            )}
          >
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton key={colIndex} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default TableSkeleton
