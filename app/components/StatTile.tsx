import * as React from "react"
import Link from "next/link"

import { cn } from "@/components/lib/utils"

export interface StatTileProps {
  /** Tiny uppercase kicker above the numeral, e.g. "Membership". */
  eyebrow: string
  /** Big Oswald numeral — the headline value. */
  value: React.ReactNode
  /** Uppercase label under the numeral, e.g. "Pending Requests". */
  label: string
  /** Optional trend/last-updated hint line under the label. */
  hint?: React.ReactNode
  /** Makes the tile a clickable link (dashboard tiles route to the relevant screen). */
  href?: string
  onClick?: () => void
  className?: string
}

/**
 * Dashboard stat tile (DESIGN_BRIEF §5/prototype): 8px maroon top band,
 * Oswald numeral (large, tabular), uppercase label, eyebrow kicker, optional
 * trend/hint line, optionally clickable (href or onClick).
 */
export function StatTile({
  eyebrow,
  value,
  label,
  hint,
  href,
  onClick,
  className,
}: StatTileProps) {
  const isInteractive = Boolean(href || onClick)

  const content = (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-sm border border-[#EAEAEA] border-t-8 border-t-brand bg-white px-[18px] pb-[18px] pt-4 text-left",
        isInteractive &&
          "transition-colors hover:border-[#D1D1D1] hover:shadow-[0_4px_14px_rgba(60,0,28,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7B7B7] focus-visible:ring-offset-2",
        className
      )}
    >
      <span className="font-body text-[10px] font-bold uppercase tracking-[.18em] text-brand-light">
        {eyebrow}
      </span>
      <span className="my-0.5 font-display text-[46px] font-semibold leading-none tabular-nums text-brand">
        {value}
      </span>
      <span className="font-body text-xs font-bold uppercase tracking-wide text-[#3E3E3E]">
        {label}
      </span>
      {hint ? (
        <span className="mt-1 font-sans text-xs text-[#707070]">{hint}</span>
      ) : null}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block w-full">
        {content}
      </button>
    )
  }

  return content
}

export default StatTile
