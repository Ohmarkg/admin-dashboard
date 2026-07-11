"use client";

import * as React from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";

import PageHeader from "@/components/PageHeader";
import BrandTabs from "@/components/BrandTabs";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TableSkeleton } from "@/components/TableSkeleton";
import MemberCard from "@/components/MemberCard";
import { OfficerBadge, VerifiedBadge, NeutralBadge } from "@/components/Badges";
import {
    useMembershipRequests,
    useOfficialMembers,
    useApproveMembership,
    useDenyMembership,
    useMembers,
    type MembershipRequestRow,
} from "@/lib/hooks/useMembership";
import type { MemberPublic } from "@/lib/hooks/useMembership";
import type { Roles } from "@/types/user";

// Membership screen (DESIGN_BRIEF §4 "Membership"): three tabs — Official
// Members, Requests (action center), All Users. Reads go through TanStack
// Query hooks; writes (approve/deny) are fired through useMutation which
// auto-invalidates all three query keys on success.

type MembershipTab = "official" | "requests" | "users";

const ROLE_LABELS: Array<{ key: keyof Roles; label: string }> = [
    { key: "admin", label: "Admin" },
    { key: "officer", label: "Officer" },
    { key: "developer", label: "Developer" },
    { key: "lead", label: "Lead" },
    { key: "representative", label: "Representative" },
    { key: "secretary", label: "Secretary" },
];

// ---------------------------------------------------------------------------
// Requests tab
// ---------------------------------------------------------------------------

function RequestsTab() {
    const requestsQuery = useMembershipRequests();
    const approveMutation = useApproveMembership();
    const denyMutation = useDenyMembership();

    const requests = requestsQuery.data ?? [];

    if (requestsQuery.isLoading) {
        return <TableSkeleton rows={4} columns={4} />;
    }

    if (requestsQuery.isError) {
        return (
            <ErrorState
                message="We couldn't load membership requests. Please try again."
                onRetry={() => requestsQuery.refetch()}
            />
        );
    }

    if (requests.length === 0) {
        return (
            <EmptyState
                title="No pending requests"
                message="All caught up — no membership requests need review."
            />
        );
    }

    function handleApprove(row: MembershipRequestRow) {
        approveMutation.mutate(row.uid, {
            onSuccess: () =>
                toast.success(`Approved ${row.name || "member"}'s membership`),
            onError: (error: unknown) =>
                toast.error(
                    error instanceof Error ? error.message : "Failed to approve membership"
                ),
        });
    }

    function handleDeny(row: MembershipRequestRow) {
        denyMutation.mutate(row.uid, {
            onSuccess: () =>
                toast.success(`Denied ${row.name || "member"}'s membership request`),
            onError: (error: unknown) =>
                toast.error(
                    error instanceof Error ? error.message : "Failed to deny membership request"
                ),
        });
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {requests.map((row) => (
                <MemberCard
                    key={row.uid}
                    member={{ uid: row.uid, name: row.name }}
                    request={{
                        shirtSize: row.shirtSize,
                        chapterURL: row.chapterURL,
                        nationalURL: row.nationalURL,
                        chapterExpiration: row.chapterExpiration,
                        nationalExpiration: row.nationalExpiration,
                    }}
                    onApprove={() => handleApprove(row)}
                    onDeny={() => handleDeny(row)}
                />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Official Members tab
// ---------------------------------------------------------------------------

function OfficialMembersTab() {
    const officialsQuery = useOfficialMembers();
    const members = officialsQuery.data ?? [];

    if (officialsQuery.isLoading) {
        return <TableSkeleton rows={4} columns={4} />;
    }

    if (officialsQuery.isError) {
        return (
            <ErrorState
                message="We couldn't load the official members list. Please try again."
                onRetry={() => officialsQuery.refetch()}
            />
        );
    }

    if (members.length === 0) {
        return (
            <EmptyState
                icon={Users}
                title="No verified members"
                message="Members will appear here once their membership has been approved and is still active."
            />
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {members.map((member) => (
                // Pass synthetic request with expirations so MemberCard's
                // isMemberVerified check fires and shows the VerifiedBadge;
                // omitting proof URLs keeps the proof-link row hidden.
                <MemberCard
                    key={member.uid}
                    member={member}
                    request={{
                        chapterExpiration: member.chapterExpiration,
                        nationalExpiration: member.nationalExpiration,
                    }}
                />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// All Users tab
// ---------------------------------------------------------------------------

function AllUsersTab() {
    const membersQuery = useMembers();
    const members = membersQuery.data ?? [];

    if (membersQuery.isLoading) {
        return <TableSkeleton rows={8} columns={5} />;
    }

    if (membersQuery.isError) {
        return (
            <ErrorState
                message="We couldn't load the member roster. Please try again."
                onRetry={() => membersQuery.refetch()}
            />
        );
    }

    if (members.length === 0) {
        return (
            <EmptyState
                icon={Users}
                title="No members yet"
                message="The full roster will appear here once members have been added."
            />
        );
    }

    return (
        <div className="overflow-hidden rounded-sm border border-[#EAEAEA] bg-white">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-[#EAEAEA] bg-brand">
                        <th className="px-4 py-3 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                            Name
                        </th>
                        <th className="px-4 py-3 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                            Major / Year
                        </th>
                        <th className="px-4 py-3 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                            Points
                        </th>
                        <th className="px-4 py-3 font-body text-[11px] font-bold uppercase tracking-wider text-white">
                            Roles
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {members.map((member, index) => (
                        <AllUsersRow
                            key={member.uid}
                            member={member}
                            isAlternate={index % 2 === 1}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function AllUsersRow({
    member,
    isAlternate,
}: {
    member: MemberPublic;
    isAlternate: boolean;
}) {
    const displayName =
        member.name || member.displayName || member.email || "Unknown member";
    const isVerified = Boolean(member.nationalExpiration && member.chapterExpiration);
    const roleEntries = ROLE_LABELS.filter(({ key }) => member.roles?.[key]);

    return (
        <tr
            className={
                isAlternate
                    ? "border-b border-[#F6F6F6] bg-[#FAFAF9]"
                    : "border-b border-[#F6F6F6] bg-white"
            }
        >
            <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                    <div className="font-body text-sm font-semibold text-[#202020]">
                        {displayName}
                    </div>
                    {isVerified ? <VerifiedBadge /> : null}
                </div>
                {member.email && member.name ? (
                    <div className="font-body text-xs text-[#A7A7A7]">{member.email}</div>
                ) : null}
            </td>
            <td className="px-4 py-3 font-body text-xs tabular-nums text-[#707070]">
                {[member.major, member.classYear].filter(Boolean).join(" · ") || "—"}
            </td>
            <td className="px-4 py-3 font-body text-sm tabular-nums text-[#3E3E3E]">
                {member.points ?? 0}
            </td>
            <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                    {member.roles?.officer ? <OfficerBadge /> : null}
                    {roleEntries
                        .filter(({ key }) => key !== "officer")
                        .map(({ key, label }) => (
                            <NeutralBadge key={key}>{label}</NeutralBadge>
                        ))}
                    {roleEntries.length === 0 ? (
                        <span className="font-body text-xs text-[#A7A7A7]">—</span>
                    ) : null}
                </div>
            </td>
        </tr>
    );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MembershipPage() {
    const [activeTab, setActiveTab] = React.useState<MembershipTab>("requests");

    // Run all three queries independently — each tab owns its own loading state.
    const requestsQuery = useMembershipRequests();
    const pendingCount = requestsQuery.data?.length ?? 0;

    const requestsLabel: React.ReactNode =
        !requestsQuery.isLoading && pendingCount > 0 ? (
            <span className="flex items-center gap-1.5">
                Requests
                <span className="rounded-full bg-brand px-2 py-0.5 font-body text-[10px] font-bold text-white leading-none">
                    {pendingCount}
                </span>
            </span>
        ) : (
            "Requests"
        );

    return (
        <div className="mx-auto max-w-[1240px] px-10 py-8">
            <PageHeader eyebrow="Membership" title="Membership" />

            <BrandTabs
                tabs={[
                    { value: "official", label: "Official Members" },
                    { value: "requests", label: requestsLabel },
                    { value: "users", label: "All Users" },
                ]}
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as MembershipTab)}
                className="mb-6"
            />

            {activeTab === "official" ? <OfficialMembersTab /> : null}
            {activeTab === "requests" ? <RequestsTab /> : null}
            {activeTab === "users" ? <AllUsersTab /> : null}
        </div>
    );
}
