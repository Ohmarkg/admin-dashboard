"use client"

import * as React from "react"
import { Timestamp } from "firebase/firestore"
import { FileText, ChevronRight } from "lucide-react"

import { cn } from "@/components/lib/utils"
import { Button } from "@/components/ui/button"
import { OfficerBadge, VerifiedBadge, NeutralBadge } from "@/components/Badges"
import type { Roles } from "@/types/user"
import { formatExpirationDate, isMemberVerified } from "@/types/membership"

type ExpirationValue = Timestamp | { seconds: number; nanoseconds: number } | undefined

/** Public member fields this card can display — a subset of `PublicUserInfo`. */
export interface MemberCardMember {
  uid?: string
  name?: string
  displayName?: string
  email?: string
  photoURL?: string
  major?: string
  classYear?: string
  roles?: Roles
}

/** Membership-request fields — present only for cards in the Requests tab. */
export interface MemberCardRequest {
  shirtSize?: string
  chapterURL?: string
  nationalURL?: string
  chapterExpiration?: ExpirationValue
  nationalExpiration?: ExpirationValue
  /** Pre-formatted submission hint, e.g. "3 days ago". */
  submittedLabel?: string
}

export interface MemberCardProps {
  member: MemberCardMember
  /** Include to render the request-specific fields (proof links, expirations, shirt size). */
  request?: MemberCardRequest
  /** Rendering Approve/Deny buttons requires providing the corresponding callback. */
  onApprove?: (member: MemberCardMember) => void | Promise<void>
  onDeny?: (member: MemberCardMember) => void | Promise<void>
  /**
   * When provided, the national expiration becomes editable before approve
   * (parity with mobile MemberSHPEConfirm "Adjust Date"): a date input is
   * rendered whose value is `nationalExpirationOverride` (yyyy-MM-dd; empty =
   * keep the request's own date). Chapter expiration is intentionally not
   * editable — mobile offers no such adjustment.
   */
  onNationalExpirationOverrideChange?: (value: string) => void
  nationalExpirationOverride?: string
  className?: string
}

function getInitials(label: string | undefined): string {
  if (!label) return "?"
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

const ROLE_LABELS: Array<{ key: keyof Roles; label: string }> = [
  { key: "admin", label: "Admin" },
  { key: "developer", label: "Developer" },
  { key: "lead", label: "Lead" },
  { key: "representative", label: "Representative" },
  { key: "secretary", label: "Secretary" },
]

/**
 * Member/request card (DESIGN_BRIEF §4.4, §5; prototype "MEMBERSHIP" screen).
 * Presentational only — data and mutation callbacks are supplied by the
 * caller (Approve/Deny buttons render only when the corresponding callback
 * is provided; verbs are approve/deny per CLAUDE.md rule 4).
 */
export function MemberCard({
  member,
  request,
  onApprove,
  onDeny,
  onNationalExpirationOverrideChange,
  nationalExpirationOverride,
  className,
}: MemberCardProps) {
  const [isApproving, setIsApproving] = React.useState(false)
  const [isDenying, setIsDenying] = React.useState(false)
  const isPending = isApproving || isDenying

  const displayName = member.name || member.displayName || member.email || "Unknown member"
  const isOfficer = Boolean(member.roles?.officer)
  const isVerified = isMemberVerified(
    request?.nationalExpiration,
    request?.chapterExpiration
  )

  const roleBadges = ROLE_LABELS.filter(({ key }) => member.roles?.[key])

  const handleApprove = async () => {
    if (!onApprove || isPending) return
    setIsApproving(true)
    try {
      await onApprove(member)
    } finally {
      setIsApproving(false)
    }
  }

  const handleDeny = async () => {
    if (!onDeny || isPending) return
    setIsDenying(true)
    try {
      await onDeny(member)
    } finally {
      setIsDenying(false)
    }
  }

  return (
    <div
      className={cn(
        "rounded-sm border border-[#EAEAEA] bg-white p-[18px]",
        className
      )}
    >
      <div className="mb-3.5 flex items-center gap-3">
        {member.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={member.photoURL}
            alt={displayName}
            className="h-10 w-10 flex-none rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-light font-body text-sm font-semibold text-white">
            {getInitials(displayName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-[#202020]">
            {displayName}
          </div>
          <div className="truncate font-body text-xs text-[#707070]">
            {[member.major, member.classYear].filter(Boolean).join(" · ")}
            {request?.submittedLabel
              ? `${member.major || member.classYear ? " · " : ""}submitted ${request.submittedLabel}`
              : null}
            {!member.major && !member.classYear && !request?.submittedLabel
              ? member.email
              : null}
          </div>
        </div>
        <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
          {isOfficer ? <OfficerBadge /> : null}
          {isVerified ? <VerifiedBadge /> : null}
          {roleBadges.map(({ key, label }) => (
            <NeutralBadge key={key}>{label}</NeutralBadge>
          ))}
          {request?.shirtSize ? (
            <span className="rounded-sm border border-[#EAEAEA] bg-[#F6F6F6] px-2.5 py-0.5 font-body text-[11px] font-semibold text-[#3E3E3E]">
              Shirt {request.shirtSize}
            </span>
          ) : null}
        </div>
      </div>

      {request ? (
        <>
          <div className="mb-3 flex gap-2.5">
            {request.chapterURL ? (
              <a
                href={request.chapterURL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center gap-1.5 rounded-sm border border-[#EAEAEA] bg-[#FAFAF7] px-2.5 py-2 font-body text-xs font-semibold text-[#3E3E3E] no-underline"
              >
                <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
                Chapter proof
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-[#A7A7A7]" />
              </a>
            ) : null}
            {request.nationalURL ? (
              <a
                href={request.nationalURL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center gap-1.5 rounded-sm border border-[#EAEAEA] bg-[#FAFAF7] px-2.5 py-2 font-body text-xs font-semibold text-[#3E3E3E] no-underline"
              >
                <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
                National proof
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-[#A7A7A7]" />
              </a>
            ) : null}
          </div>

          {request.chapterExpiration || request.nationalExpiration || onNationalExpirationOverrideChange ? (
            <div className="mb-3.5 font-body text-xs text-[#707070]">
              <div>
                Chapter exp:{" "}
                <span className="font-semibold text-[#3E3E3E]">
                  {formatExpirationDate(request.chapterExpiration) || "—"}
                </span>{" "}
                · National exp:{" "}
                <span className="font-semibold text-[#3E3E3E]">
                  {formatExpirationDate(request.nationalExpiration) || "—"}
                </span>
              </div>
              {onNationalExpirationOverrideChange ? (
                <label className="mt-2 flex items-center gap-2">
                  <span className="whitespace-nowrap">Adjust national exp:</span>
                  <input
                    type="date"
                    value={nationalExpirationOverride ?? ""}
                    onChange={(e) => onNationalExpirationOverrideChange(e.target.value)}
                    className="h-7 rounded-sm border border-[#EAEAEA] bg-white px-2 font-body text-xs text-[#3E3E3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Override national expiration date"
                  />
                  {nationalExpirationOverride ? (
                    <button
                      type="button"
                      onClick={() => onNationalExpirationOverrideChange("")}
                      className="text-[#A7A7A7] underline hover:text-[#3E3E3E]"
                    >
                      reset
                    </button>
                  ) : null}
                </label>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {onApprove || onDeny ? (
        <div className="flex gap-2.5">
          {onApprove ? (
            <Button
              type="button"
              onClick={handleApprove}
              disabled={isPending}
              className="flex-1 font-display uppercase tracking-wide"
            >
              {isApproving ? "Approving…" : "Approve"}
            </Button>
          ) : null}
          {onDeny ? (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeny}
              disabled={isPending}
              className="flex-1 border border-[#FCA5A5] bg-white font-display uppercase tracking-wide text-destructive hover:bg-[#FEF2F2]"
            >
              {isDenying ? "Denying…" : "Deny"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default MemberCard
