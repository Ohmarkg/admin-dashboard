"use client"

import * as React from "react"

import { cn } from "@/components/lib/utils"
import { getLogoComponent, type Committee, type CommitteeLogosName } from "@/types/committees"
import type { PublicUserInfo } from "@/types/user"

const BRAND_MAROON = "#500000"

function getInitials(label: string | undefined): string {
  if (!label) return "?"
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/**
 * `committeeLogos` entries are `.svg` imports from `/public/*` (see
 * `app/types/committees.ts`). Without an SVGR loader configured, Next's
 * default asset pipeline resolves a static `.svg` import to a
 * `{src,height,width,...}` object rather than a React component or a plain
 * URL string (the OLD app rendered these via an SVGR-transformed React
 * component — `<LogoComponent .../>` — which this rebuild's plain
 * `next.config.js` doesn't set up). Resolve whichever shape comes back into
 * a plain URL string so `<img src=...>` always gets a real path instead of
 * stringifying an object to "[object Object]".
 */
function resolveLogoSrc(logo: unknown): string | undefined {
  if (typeof logo === "string") return logo
  if (logo && typeof logo === "object" && "src" in logo) {
    return (logo as { src: string }).src
  }
  return undefined
}

function UserAvatar({ user, size = "sm" }: { user: PublicUserInfo; size?: "sm" | "md" }) {
  const displayName = user.name || user.displayName || user.email || "?"
  const dim = size === "md" ? "h-9 w-9 text-sm" : "h-7 w-7 text-xs"
  return user.photoURL ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={user.photoURL}
      alt={displayName}
      className={cn("flex-none rounded-full object-cover", dim)}
    />
  ) : (
    <div
      className={cn(
        "flex flex-none items-center justify-center rounded-full bg-brand-light font-body font-semibold text-white",
        dim
      )}
    >
      {getInitials(displayName)}
    </div>
  )
}

export interface CommitteeCardProps {
  committee: Committee
  className?: string
}

/**
 * Committee directory card (DESIGN_BRIEF §4.5, §5): 8px top accent band in the
 * committee's own color, logo, name, description, head/leads, member count.
 * Presentational only — no mutations, no data fetching.
 */
export function CommitteeCard({ committee, className }: CommitteeCardProps) {
  const {
    name,
    color,
    logo,
    description,
    head,
    leads,
    memberCount,
  } = committee

  const accentColor = color || BRAND_MAROON

  const logoKey = (logo ?? "default") as CommitteeLogosName
  const { LogoComponent, width, height } = getLogoComponent(logoKey)
  const logoSrc = resolveLogoSrc(LogoComponent)

  const displayName = name || "Untitled Committee"

  const leadsToShow = leads?.filter(Boolean) ?? []

  return (
    <div
      className={cn(
        "flex flex-col rounded-sm border border-[#EAEAEA] bg-white border-t-8",
        className
      )}
      style={{ borderTopColor: accentColor }}
    >
      {/* Logo band */}
      <div
        className="flex items-center justify-center px-6 py-6"
        style={{ backgroundColor: `${accentColor}18` }}
      >
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoSrc}
            alt={displayName}
            width={width}
            height={height}
            style={{ maxWidth: width, maxHeight: height }}
          />
        ) : null}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 p-[18px]">
        {/* Name */}
        <div className="font-display text-[17px] font-semibold uppercase leading-tight tracking-[0.02em] text-[#202020]">
          {displayName}
        </div>

        {/* Description */}
        {description ? (
          <p className="font-sans text-[13px] leading-snug text-[#707070] line-clamp-3">
            {description}
          </p>
        ) : null}

        {/* Head */}
        {head ? (
          <div className="flex items-center gap-2.5">
            <UserAvatar user={head} size="md" />
            <div className="min-w-0">
              <div className="font-body text-[10px] font-bold uppercase tracking-[.14em] text-[#A7A7A7]">
                Head
              </div>
              <div className="truncate font-body text-[13px] font-semibold text-[#202020]">
                {head.name || head.displayName || head.email || "—"}
              </div>
            </div>
          </div>
        ) : null}

        {/* Leads */}
        {leadsToShow.length > 0 ? (
          <div>
            <div className="mb-1.5 font-body text-[10px] font-bold uppercase tracking-[.14em] text-[#A7A7A7]">
              Leads
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {leadsToShow.map((lead, i) => {
                const leadName = lead.name || lead.displayName || lead.email
                return (
                  <div
                    key={lead.uid ?? i}
                    className="flex items-center gap-1.5 rounded-sm border border-[#EAEAEA] bg-[#FAFAF9] px-2 py-1"
                  >
                    <UserAvatar user={lead} size="sm" />
                    {leadName ? (
                      <span className="font-body text-[12px] text-[#3E3E3E]">{leadName}</span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* Member count */}
        {memberCount !== undefined ? (
          <div className="mt-auto pt-1 font-body text-[12px] font-semibold text-[#707070]">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default CommitteeCard
