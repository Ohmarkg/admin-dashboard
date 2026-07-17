"use client";

import * as React from "react";
import { toast } from "sonner";

import FormDialog from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useMembers } from "@/lib/hooks/usePoints";
import { useTrackMembers } from "@/lib/hooks/useConventionTracker";

// Convention Tracker "Add members" dialog: search the full member roster
// (excluding already-tracked uids) and multi-select who to add to the
// convention-tracking roster in one batch, or add a single member instantly
// via the row's ghost "Add" shortcut.

const MAX_VISIBLE = 50;

export default function AddMembersDialog({
    open,
    onOpenChange,
    trackedUids,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trackedUids: Set<string>;
}) {
    const membersQuery = useMembers();
    const trackMembers = useTrackMembers();
    const [search, setSearch] = React.useState("");
    const [selected, setSelected] = React.useState<Set<string>>(new Set());

    const members = membersQuery.data ?? [];

    const filteredMembers = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        const untracked = members.filter((m) => !trackedUids.has(m.uid));
        if (!q) return untracked;
        return untracked.filter((m) => {
            const name = (m.name || m.displayName || "").toLowerCase();
            const email = (m.email || "").toLowerCase();
            return name.includes(q) || email.includes(q);
        });
    }, [members, trackedUids, search]);

    const visibleMembers = filteredMembers.slice(0, MAX_VISIBLE);

    function resetAndClose() {
        setSelected(new Set());
        setSearch("");
        onOpenChange(false);
    }

    function toggleSelected(uid: string) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) {
                next.delete(uid);
            } else {
                next.add(uid);
            }
            return next;
        });
    }

    function toggleSelectAllVisible() {
        setSelected((prev) => {
            const allSelected = visibleMembers.every((m) => prev.has(m.uid));
            const next = new Set(prev);
            if (allSelected) {
                visibleMembers.forEach((m) => next.delete(m.uid));
            } else {
                visibleMembers.forEach((m) => next.add(m.uid));
            }
            return next;
        });
    }

    function handleAddSingle(uid: string) {
        trackMembers.mutate([uid], {
            onSuccess: () => {
                toast.success("Member added to convention tracking");
                setSelected((prev) => {
                    const next = new Set(prev);
                    next.delete(uid);
                    return next;
                });
            },
            onError: (error: unknown) => {
                toast.error(
                    error instanceof Error ? error.message : "Failed to add member"
                );
            },
        });
    }

    function handleAddSelected() {
        const uids = Array.from(selected);
        trackMembers.mutate(uids, {
            onSuccess: () => {
                toast.success(
                    uids.length === 1
                        ? "Added 1 member to convention tracking"
                        : `Added ${uids.length} members to convention tracking`
                );
                resetAndClose();
            },
            onError: (error: unknown) => {
                toast.error(
                    error instanceof Error ? error.message : "Failed to add members"
                );
            },
        });
    }

    const allVisibleSelected =
        visibleMembers.length > 0 && visibleMembers.every((m) => selected.has(m.uid));

    return (
        <FormDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) resetAndClose();
                else onOpenChange(next);
            }}
            eyebrow="Convention Tracker"
            title="Add members"
            footer={
                <>
                    <Button type="button" variant="outline" onClick={resetAndClose}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleAddSelected}
                        disabled={selected.size === 0 || trackMembers.isPending}
                    >
                        {trackMembers.isPending
                            ? "Adding…"
                            : `Add ${selected.size} member${selected.size === 1 ? "" : "s"}`}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <Input
                    placeholder="Search by name or email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />

                <div className="flex items-center gap-3 border-b border-[#EAEAEA] pb-2">
                    <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={toggleSelectAllVisible}
                        disabled={visibleMembers.length === 0}
                        aria-label="Select all visible members"
                    />
                    <span className="font-body text-xs font-semibold uppercase tracking-wide text-[#707070]">
                        Select all
                    </span>
                </div>

                <div className="max-h-[360px] overflow-y-auto">
                    {membersQuery.isLoading ? (
                        <p className="py-6 text-center font-body text-sm text-muted-foreground">
                            Loading members…
                        </p>
                    ) : visibleMembers.length === 0 ? (
                        <p className="py-6 text-center font-body text-sm text-muted-foreground">
                            No members match your search.
                        </p>
                    ) : (
                        <div className="flex flex-col divide-y divide-[#F6F6F6]">
                            {visibleMembers.map((member) => (
                                <div
                                    key={member.uid}
                                    className="flex items-center gap-3 py-2.5"
                                >
                                    <Checkbox
                                        checked={selected.has(member.uid)}
                                        onCheckedChange={() => toggleSelected(member.uid)}
                                        aria-label={`Select ${member.name || member.displayName || member.uid}`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-semibold text-[#202020]">
                                            {member.name || member.displayName || "N/A"}
                                        </div>
                                        <div className="truncate font-body text-sm text-[#707070]">
                                            {member.email || "N/A"}
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleAddSingle(member.uid)}
                                        disabled={trackMembers.isPending}
                                    >
                                        Add
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {filteredMembers.length > MAX_VISIBLE ? (
                    <p className="font-body text-xs text-muted-foreground">
                        Showing {MAX_VISIBLE} of {filteredMembers.length} — refine your search.
                    </p>
                ) : null}
            </div>
        </FormDialog>
    );
}
