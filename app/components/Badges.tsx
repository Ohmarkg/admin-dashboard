import * as React from "react"

import { cn } from "@/components/lib/utils"

type BadgeSpanProps = React.HTMLAttributes<HTMLSpanElement>

const badgeBase =
  "inline-block whitespace-nowrap rounded-sm px-2.5 py-0.5 font-body text-[10px] font-bold uppercase tracking-wider"

/**
 * Officer-identity badge — officer-gold (#FCE300) fill, dark ink text.
 * Reserve strictly for officer identity per DESIGN_BRIEF §2/§7.
 */
export function OfficerBadge({ className, children, ...props }: BadgeSpanProps) {
  return (
    <span
      className={cn(badgeBase, "bg-gold text-[#202020]", className)}
      {...props}
    >
      {children ?? "Officer"}
    </span>
  )
}

/**
 * Verified-member badge — maroon fill, white text.
 */
export function VerifiedBadge({ className, children, ...props }: BadgeSpanProps) {
  return (
    <span
      className={cn(badgeBase, "bg-brand text-white", className)}
      {...props}
    >
      {children ?? "Verified"}
    </span>
  )
}

/**
 * Neutral/default badge — light gray fill, muted text (roles/statuses with
 * no special identity, e.g. Student, Guest).
 */
export function NeutralBadge({ className, children, ...props }: BadgeSpanProps) {
  return (
    <span
      className={cn(badgeBase, "bg-[#EAEAEA] text-[#626262]", className)}
      {...props}
    >
      {children}
    </span>
  )
}
