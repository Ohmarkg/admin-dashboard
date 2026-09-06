"use client";

import * as React from "react";
import { Pencil, Plus, RefreshCcw, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/PageHeader";
import BrandTabs from "@/components/BrandTabs";
import ConfirmDialog from "@/components/ConfirmDialog";
import CommitteeEditorDialog from "@/components/CommitteeEditorDialog";
import CommitteeRosterDialog from "@/components/CommitteeRosterDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { CommitteeCard } from "@/components/CommitteeCard";
import type { Committee } from "@/types/committees";
import {
    useApproveCommitteeRequest,
    useCommitteeRequests,
    useCommittees,
    useDeleteCommittee,
    useDenyCommitteeRequest,
    useResetCommittee,
    type CommitteeRequestRow,
} from "@/lib/hooks/useCommittees";

function CommitteeGridSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-sm border bg-white">
                    <Skeleton className="h-[120px] w-full rounded-none" />
                    <div className="space-y-3 p-[18px]"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-9 w-full" /></div>
                </div>
            ))}
        </div>
    );
}

export default function CommitteesPage() {
    const committeesQuery = useCommittees();
    const requestsQuery = useCommitteeRequests();
    const resetCommittee = useResetCommittee();
    const deleteCommittee = useDeleteCommittee();
    const [editorOpen, setEditorOpen] = React.useState(false);
    const [editing, setEditing] = React.useState<Committee>();
    const [rosterCommittee, setRosterCommittee] = React.useState<Committee>();
    const [resetTarget, setResetTarget] = React.useState<Committee>();
    const [deleteTarget, setDeleteTarget] = React.useState<Committee>();
    const committees = committeesQuery.data ?? [];
    const requestCount = requestsQuery.data?.length ?? 0;

    function openCreate() {
        setEditing(undefined);
        setEditorOpen(true);
    }

    async function handleReset() {
        if (!resetTarget) return;
        try {
            const result = await resetCommittee.mutateAsync(resetTarget.firebaseDocName);
            toast.success(`Committee reset: ${result.membersRemoved ?? 0} members and ${result.requestsRemoved ?? 0} requests removed`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not reset committee");
            throw error;
        }
    }

    async function handleDelete() {
        if (!deleteTarget) return;
        try {
            await deleteCommittee.mutateAsync(deleteTarget.firebaseDocName);
            toast.success("Committee deleted");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not delete committee");
            throw error;
        }
    }

    return (
        <div className="mx-auto max-w-[1240px] px-6 py-8 md:px-10">
            <PageHeader
                eyebrow="Chapter operations"
                title="Committees"
                description="Manage committee details, leadership, rosters, and membership requests."
                actions={<Button onClick={openCreate}><Plus />Add committee</Button>}
            />

            <BrandTabs
                defaultValue="directory"
                tabs={[
                    { value: "directory", label: "Directory" },
                    { value: "requests", label: requestCount ? `Requests (${requestCount})` : "Requests" },
                ]}
            >
                <TabsContent value="directory" className="mt-6">
                    {committeesQuery.isLoading ? (
                        <CommitteeGridSkeleton />
                    ) : committeesQuery.isError ? (
                        <ErrorState message="We couldn't load committees. Please try again." onRetry={() => committeesQuery.refetch()} />
                    ) : committees.length === 0 ? (
                        <EmptyState icon={Users} title="No committees yet" message="Create the first committee to begin managing its roster." />
                    ) : (
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                            {committees.map((committee) => (
                                <CommitteeCard
                                    key={committee.firebaseDocName}
                                    committee={committee}
                                    actions={
                                        <>
                                            <Button size="sm" variant="outline" onClick={() => { setEditing(committee); setEditorOpen(true); }}><Pencil />Edit</Button>
                                            <Button size="sm" variant="outline" onClick={() => setRosterCommittee(committee)}><UserPlus />Roster</Button>
                                            <Button size="sm" variant="ghost" onClick={() => setResetTarget(committee)}><RefreshCcw />Reset</Button>
                                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(committee)}><Trash2 />Delete</Button>
                                        </>
                                    }
                                />
                            ))}
                        </div>
                    )}
                </TabsContent>
                <TabsContent value="requests" className="mt-6">
                    <RequestsTab />
                </TabsContent>
            </BrandTabs>

            <CommitteeEditorDialog open={editorOpen} onOpenChange={setEditorOpen} committee={editing} />
            <CommitteeRosterDialog open={Boolean(rosterCommittee)} onOpenChange={(open) => !open && setRosterCommittee(undefined)} committee={rosterCommittee} />
            <ConfirmDialog
                open={Boolean(resetTarget)}
                onOpenChange={(open) => !open && setResetTarget(undefined)}
                title={`Reset ${resetTarget?.name ?? "committee"}?`}
                description="This removes every member, head, lead, representative, and pending request. Committee details and settings are preserved. No notifications will be sent."
                confirmLabel="Reset committee"
                variant="destructive"
                onConfirm={handleReset}
            />
            <ConfirmDialog
                open={Boolean(deleteTarget)}
                onOpenChange={(open) => !open && setDeleteTarget(undefined)}
                title={`Delete ${deleteTarget?.name ?? "committee"}?`}
                description="Memberships and pending requests will be removed. Deletion is blocked while the committee has active events."
                confirmLabel="Delete committee"
                variant="destructive"
                onConfirm={handleDelete}
            />
        </div>
    );
}

function RequestsTab() {
    const requestsQuery = useCommitteeRequests();
    const approve = useApproveCommitteeRequest();
    const deny = useDenyCommitteeRequest();
    const requests = requestsQuery.data ?? [];

    async function decide(row: CommitteeRequestRow, action: "approve" | "deny") {
        try {
            const result = await (action === "approve" ? approve : deny).mutateAsync({ committeeId: row.committeeId, uid: row.user.uid });
            toast.success(`${action === "approve" ? "Approved" : "Denied"} ${row.user.name || row.user.displayName || "member"}`);
            if (result.warning) toast.warning(result.warning);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : `Could not ${action} request`);
        }
    }

    if (requestsQuery.isLoading) return <CommitteeGridSkeleton />;
    if (requestsQuery.isError) return <ErrorState message="We couldn't load committee requests." onRetry={() => requestsQuery.refetch()} />;
    if (requests.length === 0) return <EmptyState icon={Users} title="No pending requests" message="All committee membership requests have been reviewed." />;

    return (
        <div className="overflow-hidden rounded-md border bg-white">
            <table className="w-full text-left text-sm">
                <thead className="bg-brand text-white">
                    <tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Committee</th><th className="hidden px-4 py-3 md:table-cell">Requested</th><th className="px-4 py-3 text-right">Actions</th></tr>
                </thead>
                <tbody className="divide-y">
                    {requests.map((row) => (
                        <tr key={`${row.committeeId}-${row.user.uid}`}>
                            <td className="px-4 py-3"><div className="font-semibold">{row.user.name || row.user.displayName || row.user.uid}</div><div className="text-xs text-muted-foreground">{row.user.email}</div></td>
                            <td className="px-4 py-3">{row.committeeName}</td>
                            <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{formatRequestDate(row.uploadDate)}</td>
                            <td className="px-4 py-3"><div className="flex justify-end gap-2"><Button size="sm" onClick={() => decide(row, "approve")} disabled={approve.isPending || deny.isPending}>Approve</Button><Button size="sm" variant="outline" onClick={() => decide(row, "deny")} disabled={approve.isPending || deny.isPending}>Deny</Button></div></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function formatRequestDate(value: string | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
