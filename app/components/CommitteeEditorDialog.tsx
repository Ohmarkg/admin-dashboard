"use client";

import * as React from "react";
import { toast } from "sonner";
import FormDialog from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { committeeLogos, committeeSlugFromName, type Committee, type CommitteeInput, type CommitteeLogosName } from "@/types/committees";
import { useMembers } from "@/lib/hooks/usePoints";
import { useCreateCommittee, useUpdateCommittee } from "@/lib/hooks/useCommittees";

const EMPTY_FORM: CommitteeInput = {
    name: "",
    color: "#500000",
    description: "",
    representatives: [],
    leads: [],
    applicationLink: "",
    logo: "default",
    isOpen: false,
};

export default function CommitteeEditorDialog({
    open,
    onOpenChange,
    committee,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    committee?: Committee;
}) {
    const membersQuery = useMembers();
    const createCommittee = useCreateCommittee();
    const updateCommittee = useUpdateCommittee();
    const [form, setForm] = React.useState<CommitteeInput>(EMPTY_FORM);

    React.useEffect(() => {
        if (!open) return;
        setForm(
            committee
                ? {
                      name: committee.name,
                      color: committee.color,
                      description: committee.description,
                      head: committee.head?.uid,
                      leads: committee.leads.map((member) => member.uid).filter((uid): uid is string => Boolean(uid)),
                      representatives: committee.representatives.map((member) => member.uid).filter((uid): uid is string => Boolean(uid)),
                      applicationLink: committee.applicationLink,
                      logo: committee.logo,
                      isOpen: committee.isOpen,
                  }
                : EMPTY_FORM
        );
    }, [committee, open]);

    const members = membersQuery.data ?? [];
    const headCandidates = members.filter((member) => member.roles?.officer || member.roles?.lead || member.roles?.representative);
    const leadCandidates = members.filter((member) => member.roles?.lead);
    const representativeCandidates = members.filter((member) => member.roles?.representative);
    const pending = createCommittee.isPending || updateCommittee.isPending;

    function set<K extends keyof CommitteeInput>(key: K, value: CommitteeInput[K]) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    function toggleUid(key: "leads" | "representatives", uid: string) {
        setForm((current) => ({
            ...current,
            [key]: current[key].includes(uid)
                ? current[key].filter((value) => value !== uid)
                : [...current[key], uid],
        }));
    }

    async function handleSubmit() {
        if (!form.name.trim()) {
            toast.error("Committee name is required");
            return;
        }
        try {
            if (committee) {
                await updateCommittee.mutateAsync({ id: committee.firebaseDocName, input: form });
                toast.success("Committee updated");
            } else {
                await createCommittee.mutateAsync(form);
                toast.success("Committee created");
            }
            onOpenChange(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not save committee");
        }
    }

    return (
        <FormDialog
            open={open}
            onOpenChange={(next) => !pending && onOpenChange(next)}
            eyebrow="Committee management"
            title={committee ? `Edit ${committee.name}` : "Create committee"}
            footer={
                <>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={pending || membersQuery.isLoading}>
                        {pending ? "Saving…" : committee ? "Save changes" : "Create committee"}
                    </Button>
                </>
            }
        >
            <div className="space-y-6">
                <Section title="Identity">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Name" htmlFor="committee-name">
                            <Input id="committee-name" value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={100} />
                        </Field>
                        <Field label="Document ID" htmlFor="committee-slug">
                            <Input id="committee-slug" value={committee?.firebaseDocName ?? committeeSlugFromName(form.name)} disabled />
                        </Field>
                        <Field label="Color" htmlFor="committee-color">
                            <div className="flex gap-2">
                                <Input id="committee-color" type="color" className="w-14 p-1" value={form.color} onChange={(event) => set("color", event.target.value)} />
                                <Input value={form.color} onChange={(event) => set("color", event.target.value)} pattern="#[0-9A-Fa-f]{6}" />
                            </div>
                        </Field>
                        <Field label="Logo" htmlFor="committee-logo">
                            <Select value={form.logo} onValueChange={(value) => set("logo", value as CommitteeLogosName)}>
                                <SelectTrigger id="committee-logo"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {(Object.keys(committeeLogos) as CommitteeLogosName[]).map((logo) => (
                                        <SelectItem value={logo} key={logo}>{logo}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <Field label="Description" htmlFor="committee-description">
                        <textarea
                            id="committee-description"
                            value={form.description}
                            onChange={(event) => set("description", event.target.value)}
                            maxLength={250}
                            rows={4}
                            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <span className="text-xs text-muted-foreground">{form.description.length}/250</span>
                    </Field>
                    <Field label="Application link" htmlFor="committee-link">
                        <Input id="committee-link" type="url" value={form.applicationLink} onChange={(event) => set("applicationLink", event.target.value)} placeholder="https://…" />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={form.isOpen} onCheckedChange={(value) => set("isOpen", Boolean(value))} />
                        Open enrollment — members can join without approval
                    </label>
                </Section>

                <Section title="Leadership">
                    <p className="text-xs text-muted-foreground">Assigning leadership automatically adds that user to the committee roster.</p>
                    <Field label="Head" htmlFor="committee-head">
                        <Select value={form.head ?? "__none__"} onValueChange={(value) => set("head", value === "__none__" ? undefined : value)}>
                            <SelectTrigger id="committee-head"><SelectValue placeholder="No head assigned" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">No head assigned</SelectItem>
                                {headCandidates.map((member) => <SelectItem key={member.uid} value={member.uid}>{member.name || member.displayName || member.email || member.uid}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </Field>
                    <RoleChecklist title="Leads" candidates={leadCandidates} selected={form.leads} onToggle={(uid) => toggleUid("leads", uid)} />
                    <RoleChecklist title="Representatives" candidates={representativeCandidates} selected={form.representatives} onToggle={(uid) => toggleUid("representatives", uid)} />
                </Section>
            </div>
        </FormDialog>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return <section className="space-y-4"><h3 className="border-b pb-1 font-body text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>{children}</section>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
    return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}

function RoleChecklist({ title, candidates, selected, onToggle }: { title: string; candidates: Array<{ uid: string; name?: string; displayName?: string; email?: string }>; selected: string[]; onToggle: (uid: string) => void }) {
    return (
        <div className="space-y-2">
            <Label>{title}</Label>
            <div className="max-h-36 overflow-y-auto rounded-md border p-2">
                {candidates.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No eligible users.</p> : candidates.map((member) => (
                    <label key={member.uid} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                        <Checkbox checked={selected.includes(member.uid)} onCheckedChange={() => onToggle(member.uid)} />
                        <span className="text-sm">{member.name || member.displayName || member.email || member.uid}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}
