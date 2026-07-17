"use client";

import * as React from "react";
import { toast } from "sonner";

import FormDialog from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { NeutralBadge } from "@/components/Badges";
import { useMembers } from "@/lib/hooks/usePoints";
import { useTrackMembers } from "@/lib/hooks/useConventionTracker";
import { parseRosterFile } from "./parseRoster";

// Convention Tracker "Import from file" dialog: parse a CSV/Excel roster for
// emails, match them against the member roster, preview matched/unmatched
// counts, then track the matched-and-not-already-tracked uids in one batch.

interface MatchedMember {
    uid: string;
    name: string;
    email: string;
    alreadyTracked: boolean;
}

export default function ImportDialog({
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

    const [step, setStep] = React.useState<"select" | "preview">("select");
    const [parseError, setParseError] = React.useState<string | null>(null);
    const [matched, setMatched] = React.useState<MatchedMember[]>([]);
    const [unmatched, setUnmatched] = React.useState<string[]>([]);

    function reset() {
        setStep("select");
        setParseError(null);
        setMatched([]);
        setUnmatched([]);
    }

    function resetAndClose() {
        reset();
        onOpenChange(false);
    }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        setParseError(null);

        try {
            const emails = await parseRosterFile(file);
            const members = membersQuery.data ?? [];
            const memberByEmail = new Map(
                members.map((m) => [(m.email || "").trim().toLowerCase(), m])
            );

            const matchedRows: MatchedMember[] = [];
            const unmatchedEmails: string[] = [];

            for (const email of emails) {
                const member = memberByEmail.get(email);
                if (member) {
                    matchedRows.push({
                        uid: member.uid,
                        name: member.name || member.displayName || "N/A",
                        email: member.email || email,
                        alreadyTracked: trackedUids.has(member.uid),
                    });
                } else {
                    unmatchedEmails.push(email);
                }
            }

            setMatched(matchedRows);
            setUnmatched(unmatchedEmails);
            setStep("preview");
        } catch (error) {
            setParseError(
                error instanceof Error ? error.message : "Failed to parse roster file"
            );
        }
    }

    const matchedNew = matched.filter((m) => !m.alreadyTracked);
    const matchedAlready = matched.filter((m) => m.alreadyTracked);

    function handleAdd() {
        const uids = matchedNew.map((m) => m.uid);
        trackMembers.mutate(uids, {
            onSuccess: () => {
                toast.success(
                    `Added ${uids.length} member${uids.length === 1 ? "" : "s"} · ${matchedAlready.length} already tracked · ${unmatched.length} not found`
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

    return (
        <FormDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) resetAndClose();
                else onOpenChange(next);
            }}
            eyebrow="Convention Tracker"
            title="Import from file"
            footer={
                step === "select" ? (
                    <Button type="button" variant="outline" onClick={resetAndClose}>
                        Cancel
                    </Button>
                ) : (
                    <>
                        <Button type="button" variant="outline" onClick={reset}>
                            Back
                        </Button>
                        <Button
                            type="button"
                            onClick={handleAdd}
                            disabled={matchedNew.length === 0 || trackMembers.isPending}
                        >
                            {trackMembers.isPending
                                ? "Adding…"
                                : `Add ${matchedNew.length} member${matchedNew.length === 1 ? "" : "s"}`}
                        </Button>
                    </>
                )
            }
        >
            {step === "select" ? (
                <div className="flex flex-col gap-3">
                    <input
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={handleFileChange}
                        className="block w-full font-body text-sm text-[#202020] file:mr-4 file:rounded-sm file:border-0 file:bg-brand file:px-4 file:py-2 file:font-body file:text-sm file:font-semibold file:text-white hover:file:bg-brand/90"
                    />
                    <p className="font-body text-sm text-muted-foreground">
                        CSV or Excel with an email column.
                    </p>
                    {parseError ? (
                        <p className="font-body text-sm text-[#B91C1C]">{parseError}</p>
                    ) : null}
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <p className="font-body text-sm text-[#202020]">
                        <span className="font-semibold">{matchedNew.length}</span> will be
                        added ·{" "}
                        <span className="font-semibold">{matchedAlready.length}</span>{" "}
                        already tracked · <span className="font-semibold">{unmatched.length}</span>{" "}
                        not found
                    </p>

                    {matched.length > 0 ? (
                        <div className="max-h-[280px] overflow-y-auto rounded-sm border border-[#EAEAEA]">
                            <div className="flex flex-col divide-y divide-[#F6F6F6]">
                                {matched.map((member) => (
                                    <div
                                        key={member.uid}
                                        className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div
                                                className={
                                                    member.alreadyTracked
                                                        ? "truncate font-semibold text-[#A7A7A7]"
                                                        : "truncate font-semibold text-[#202020]"
                                                }
                                            >
                                                {member.name}
                                            </div>
                                            <div className="truncate font-body text-sm text-[#707070]">
                                                {member.email}
                                            </div>
                                        </div>
                                        {member.alreadyTracked ? (
                                            <NeutralBadge>Already tracked</NeutralBadge>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {unmatched.length > 0 ? (
                        <div>
                            <div className="mb-1.5 font-body text-xs font-semibold uppercase tracking-wide text-[#707070]">
                                Not found — will be skipped
                            </div>
                            <div className="max-h-[160px] overflow-y-auto rounded-sm border border-[#EAEAEA] px-3.5 py-2.5">
                                {unmatched.map((email) => (
                                    <div
                                        key={email}
                                        className="font-body text-sm text-[#A7A7A7]"
                                    >
                                        {email}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            )}
        </FormDialog>
    );
}
