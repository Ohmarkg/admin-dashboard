import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Inbox } from "lucide-react"

import { cn } from "@/components/lib/utils"
import { Button } from "@/components/ui/button"

export interface EmptyStateProps {
  icon?: LucideIcon
  /** Oswald-style heading, e.g. "No requests to review". */
  title: string
  /** Editorial (Crimson Text italic) supporting line, per prototype. */
  message?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

/**
 * Friendly empty state per DESIGN_BRIEF §7.5 / prototype: icon, one-line
 * explanation (serif italic accent), optional primary action.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-sm border border-[#EAEAEA] bg-white px-14 py-14 text-center",
        className
      )}
    >
      <Icon className="mb-1 h-8 w-8 text-[#A7A7A7]" strokeWidth={1.5} />
      <div className="font-display text-lg font-medium uppercase tracking-wide text-[#202020]">
        {title}
      </div>
      {message ? (
        <p className="font-serif text-[15px] italic text-[#707070]">
          {message}
        </p>
      ) : null}
      {action ? (
        <Button onClick={action.onClick} className="mt-3">
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

export default EmptyState
