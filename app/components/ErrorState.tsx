import * as React from "react"
import { AlertTriangle } from "lucide-react"

import { cn } from "@/components/lib/utils"
import { Button } from "@/components/ui/button"

export interface ErrorStateProps {
  /** Oswald-style heading, defaults to a generic failure message. */
  title?: string
  /** Supporting detail, e.g. the caught error's message. */
  message?: string
  /** Retry affordance — omit to render a message-only error card. */
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/**
 * Inline error card with a retry affordance per DESIGN_BRIEF §7.5.
 */
export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this data. Please try again.",
  onRetry,
  retryLabel = "Retry",
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-sm border border-[#FCA5A5] bg-[#FEF2F2] px-14 py-12 text-center",
        className
      )}
    >
      <AlertTriangle className="mb-1 h-8 w-8 text-[#B91C1C]" strokeWidth={1.5} />
      <div className="font-display text-lg font-medium uppercase tracking-wide text-[#202020]">
        {title}
      </div>
      <p className="font-sans text-sm text-[#626262]">{message}</p>
      {onRetry ? (
        <Button variant="destructive" onClick={onRetry} className="mt-3">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}

export default ErrorState
