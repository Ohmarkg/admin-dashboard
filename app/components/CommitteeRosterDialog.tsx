"use client";

import * as React from "react";
import { toast } from "sonner";
import FormDialog from "@/components/FormDialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Committee } from "@/types/committees";
import { useMembers } from "@/lib/hooks/usePoints";
import { useAddCommitteeMembers, useCommitteeMembers, useRemoveCommitteeMember, type CommitteeMember } from "@/lib/hooks/useCommittees";

export default function CommitteeRosterDialog({ open, onOpenChange, committee }: { open: boolean; onOpenChange: (open: boolean) => void; committee?: Committee }) {
    const rosterQuery = useCommitteeMembers(committee?.firebaseDocName);
    const membersQuery = useMembers();
    const addMembers = useAddCommitteeMembers();
    const removeMember = useRemoveCommitteeMember();
    const [search, setSearch] = React.useState("");
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [removeTarget, setRemoveTarget] = React.useState<CommitteeMember>();

    // The page keeps this dialog mounted (`committee` just goes undefined), so
    // returning null below does NOT unmount it and its state survives a close.
    // Without this reset, users ticked for committee A stay selected when the
    // dialog reopens on committee B and get added to the wrong roster.
    // Mirrors the reset effect in CommitteeEditorDialog.
    React.useEffect(() => {
        if (!open) return;
        setSearch("");
        setSelected(new Set());
        setRemoveTarget(undefined);
    }, [committee, open]);

    if (!committee) return null;
    const roster = rosterQuery.data ?? [];
    const rosterIds = new Set(roster.map((member) => member.uid));
    const candidates = (membersQuery.data ?? []).filter((member) => {
        if (rosterIds.has(member.uid)) return false;
        const haystack = `${member.name ?? ""} ${member.displayName ?? ""} ${member.email ?? ""}`.toLowerCase();
        return haystack.includes(search.trim().toLowerCase());
    }).slice(0, 50);

    async function handleAdd() {
        try {
            const result = await addMembers.mutateAsync({ id: committee!.firebaseDocName, uids: [...selected] });
            toast.success(`Added ${result.added ?? selected.size} member${(result.added ?? selected.size) === 1 ? "" : "s"}`);
            setSelected(new Set());
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not add members");
        }
    }

    async function handleRemove() {
        if (!removeTarget) return;
        try {
            await removeMember.mutateAsync({ id: committee!.firebaseDocName, uid: removeTarget.uid });
            toast.success("Member removed");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not remove member");
            throw error;
        }
    }

    return (
        <>
            <FormDialog open={open} onOpenChange={onOpenChange} eyebrow="Committee roster" title={committee.name} className="max-w-4xl" footer={<Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>}>
                <div className="grid gap-6 md:grid-cols-2">
                    <section>
                        <h3 className="mb-3 font-body text-xs font-bold uppercase tracking-wider text-muted-foreground">Current members ({roster.length})</h3>
                        <div className="max-h-[420px] overflow-y-auto rounded-md border divide-y">
                            {rosterQuery.isLoading ? <Message>Loading roster…</Message> : roster.length === 0 ? <Message>This committee has no members.</Message> : roster.map((member) => (
                                <div key={member.uid} className="flex items-center gap-3 p-3">
                                    <MemberName member={member} />
                                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoveTarget(member)}>Remove</Button>
                                </div>
                            ))}
                        </div>
                    </section>
                    <section>
                        <h3 className="mb-3 font-body text-xs font-bold uppercase tracking-wider text-muted-foreground">Add members</h3>
                        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email…" className="mb-3" />
                        <div className="max-h-[330px] overflow-y-auto rounded-md border divide-y">
                            {membersQuery.isLoading ? <Message>Loading members…</Message> : candidates.length === 0 ? <Message>No users match your search.</Message> : candidates.map((member) => (
                                <label key={member.uid} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted">
                                    <Checkbox checked={selected.has(member.uid)} onCheckedChange={() => setSelected((current) => { const next = new Set(current); next.has(member.uid) ? next.delete(member.uid) : next.add(member.uid); return next; })} />
                                    <MemberName member={member} />
                                </label>
                            ))}
                        </div>
                        <Button className="mt-3 w-full" disabled={selected.size === 0 || addMembers.isPending} onClick={handleAdd}>{addMembers.isPending ? "Adding…" : `Add ${selected.size} selected`}</Button>
                    </section>
                </div>
            </FormDialog>
            <ConfirmDialog
                open={Boolean(removeTarget)}
                onOpenChange={(next) => !next && setRemoveTarget(undefined)}
                title="Remove committee member?"
                description="This also clears any head, lead, or representative position the member holds."
                confirmLabel="Remove member"
                variant="destructive"
                onConfirm={handleRemove}
            />
        </>
    );
}

function MemberName({ member }: { member: { uid: string; name?: string; displayName?: string; email?: string } }) {
    return <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{member.name || member.displayName || member.uid}</div><div className="truncate text-xs text-muted-foreground">{member.email || member.uid}</div></div>;
}

function Message({ children }: { children: React.ReactNode }) {
    return <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
