"use client";

import * as React from "react";
import { Users } from "lucide-react";

import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { CommitteeCard } from "@/components/CommitteeCard";
import { useCommittees } from "@/lib/hooks/useCommittees";

// Committees directory (DESIGN_BRIEF §4.5): read-only grid of committee cards.
// No edit controls — committee editing is not a feature (API.md committees note).

function CommitteeGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-sm border border-[#EAEAEA] bg-white"
        >
          <Skeleton className="h-[120px] w-full rounded-none" />
          <div className="flex flex-col gap-3 p-[18px]">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <div className="flex items-center gap-2.5 pt-1">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-2.5 w-8" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CommitteesPage() {
  const { data: committees, isLoading, isError, refetch } = useCommittees();

  return (
    <div className="mx-auto max-w-[1240px] px-10 py-8">
      <PageHeader eyebrow="Directory" title="Committees" />

      {isLoading ? (
        <CommitteeGridSkeleton />
      ) : isError ? (
        <ErrorState
          message="We couldn't load the committee directory. Please try again."
          onRetry={() => refetch()}
        />
      ) : !committees || committees.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No committees yet"
          message="Committees will appear here once they are added in Firestore."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {committees.map((committee, i) => (
            <CommitteeCard
              key={committee.firebaseDocName ?? i}
              committee={committee}
            />
          ))}
        </div>
      )}
    </div>
  );
}
