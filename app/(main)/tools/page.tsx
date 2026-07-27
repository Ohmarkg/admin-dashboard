"use client";

import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Award, Download, FileSpreadsheet, Instagram, Loader2, Shirt } from "lucide-react";
import { toast } from "sonner";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useEvents } from "@/lib/hooks/useEvents";
import { useMembers } from "@/lib/hooks/usePoints";
import { useResumeStatus, useZipResumes } from "@/lib/hooks/useTools";
import {
    buildUsersLookup,
    exportMonthAttendanceWorkbook,
    exportSchoolYearAttendanceZip,
    getAttendanceExportMonths,
    getDefaultAttendanceMonthKey,
    getMonthKey,
} from "./exportAttendance";

// Tools screen (DESIGN_BRIEF §4 "6. Tools"): utility panels — resume zip
// generator with live status (idle → generating → ready/expired) plus links
// into the Shirt Tracker, Convention Tracker, and Instagram Points sub-pages.
// No manual reload — `useResumeStatus` pushes live updates via onSnapshot.

function ResumePanel() {
    const { status, data } = useResumeStatus();
    const zipResumes = useZipResumes();

    const isGenerating = zipResumes.isPending || status?.isGenerated === false;
    const isReady = status?.isGenerated === true && data !== null;
    const isExpired = isReady && data !== null && data.expiresAt.toDate() < new Date();

    function handleGenerate() {
        zipResumes.mutate(undefined, {
            onSuccess: () => {
                toast.success("Resume zip generation started");
            },
            onError: (error: unknown) => {
                toast.error(
                    error instanceof Error ? error.message : "Failed to trigger resume zip"
                );
            },
        });
    }

    function handleDownload() {
        if (!data?.url) return;
        const anchor = document.createElement("a");
        anchor.href = data.url;
        anchor.download = "resumes.zip";
        anchor.click();
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-display text-base font-semibold uppercase tracking-wide text-foreground">
                    Resume Download
                </CardTitle>
                <CardDescription>
                    Generate a zip of all member-submitted résumés. The background
                    job writes the file to storage — status updates live below.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {/* Status / action area */}
                {isGenerating ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Generating résumé zip…</span>
                    </div>
                ) : isReady && !isExpired && data ? (
                    <div className="flex flex-col gap-3">
                        <div className="rounded-sm border border-[#EAEAEA] bg-[#F6F6F6] px-4 py-3 text-sm">
                            <div className="font-body text-[#3E3E3E]">
                                <span className="font-semibold">Created:</span>{" "}
                                {format(data.createdAt.toDate(), "MMM d, yyyy 'at' h:mm a")}
                            </div>
                            <div className="mt-0.5 font-body text-[#A7A7A7]">
                                <span className="font-semibold text-[#707070]">Expires:</span>{" "}
                                {format(data.expiresAt.toDate(), "MMM d, yyyy 'at' h:mm a")}
                            </div>
                        </div>
                        <Button
                            onClick={handleDownload}
                            className="w-fit"
                        >
                            <Download className="h-4 w-4" />
                            Download résumés
                        </Button>
                    </div>
                ) : isExpired && data ? (
                    <div className="flex flex-col gap-3">
                        <p className="text-sm text-[#B91C1C]">
                            Link expired on{" "}
                            {format(data.expiresAt.toDate(), "MMM d, yyyy 'at' h:mm a")} —
                            generate a new one.
                        </p>
                        <Button onClick={handleGenerate} disabled={zipResumes.isPending} className="w-fit">
                            Generate new zip
                        </Button>
                    </div>
                ) : (
                    /* Idle — no data yet */
                    <Button
                        onClick={handleGenerate}
                        disabled={zipResumes.isPending}
                        className="w-fit"
                    >
                        Generate résumé zip
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}

function AttendanceExportPanel() {
    const eventsQuery = useEvents();
    const membersQuery = useMembers();
    const schoolYearMonths = React.useMemo(() => getAttendanceExportMonths(), []);
    const [selectedMonthKey, setSelectedMonthKey] = React.useState(getDefaultAttendanceMonthKey);
    const [exportingYear, setExportingYear] = React.useState(false);
    const [exportingMonth, setExportingMonth] = React.useState(false);

    const isBusy = exportingYear || exportingMonth;
    const isDataReady = Boolean(eventsQuery.data && membersQuery.data);
    const isLoading = eventsQuery.isLoading || membersQuery.isLoading;
    const isError = eventsQuery.isError || membersQuery.isError;

    async function handleYearExport() {
        if (isBusy || !eventsQuery.data || !membersQuery.data) return;
        setExportingYear(true);
        try {
            await exportSchoolYearAttendanceZip(
                eventsQuery.data,
                buildUsersLookup(membersQuery.data)
            );
            toast.success("School-year attendance ZIP downloaded");
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to export school-year attendance"
            );
        } finally {
            setExportingYear(false);
        }
    }

    async function handleMonthExport() {
        if (isBusy || !eventsQuery.data || !membersQuery.data) return;
        const selectedMonth = schoolYearMonths.find(
            (month) => getMonthKey(month) === selectedMonthKey
        );
        if (!selectedMonth) {
            toast.error("Please select a valid month.");
            return;
        }

        setExportingMonth(true);
        try {
            await exportMonthAttendanceWorkbook(
                eventsQuery.data,
                buildUsersLookup(membersQuery.data),
                selectedMonth
            );
            toast.success("Monthly attendance workbook downloaded");
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Failed to export monthly attendance"
            );
        } finally {
            setExportingMonth(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-display text-base font-semibold uppercase tracking-wide text-foreground">
                    Attendance Export
                </CardTitle>
                <CardDescription>
                    Export attendance for the current school year (June–May). Each monthly
                    workbook includes per-event sheets and a unique attendees sheet. For
                    summary tables and Fall/Spring/full-year merges, run the Python scripts in{" "}
                    <code className="text-xs">scripts/</code> on the downloaded files.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                {isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Loading events and roster…</span>
                    </div>
                ) : isError ? (
                    <p className="text-sm text-[#B91C1C]">
                        Could not load events or roster. Refresh and try again.
                    </p>
                ) : (
                    <>
                        <div className="flex flex-col gap-3">
                            <div>
                                <p className="font-body text-sm font-medium text-foreground">
                                    Full school year
                                </p>
                                <p className="mt-0.5 font-body text-xs text-muted-foreground">
                                    Downloads one ZIP with an Excel file for every month.
                                </p>
                            </div>
                            <Button
                                onClick={handleYearExport}
                                disabled={!isDataReady || isBusy}
                                className="w-fit"
                            >
                                {exportingYear ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Exporting school year…
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-4 w-4" />
                                        Export attendance ZIP
                                    </>
                                )}
                            </Button>
                        </div>

                        <div className="flex flex-col gap-3">
                            <div>
                                <p className="font-body text-sm font-medium text-foreground">
                                    Single month
                                </p>
                                <p className="mt-0.5 font-body text-xs text-muted-foreground">
                                    Downloads one Excel file for the selected month.
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <Select
                                    value={selectedMonthKey}
                                    onValueChange={setSelectedMonthKey}
                                    disabled={isBusy}
                                >
                                    <SelectTrigger className="w-[200px]">
                                        <SelectValue placeholder="Select month" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {schoolYearMonths.map((month) => (
                                            <SelectItem
                                                key={getMonthKey(month)}
                                                value={getMonthKey(month)}
                                            >
                                                {format(month, "MMMM yyyy")}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    variant="outline"
                                    onClick={handleMonthExport}
                                    disabled={!isDataReady || isBusy}
                                    className="w-fit"
                                >
                                    {exportingMonth ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Exporting month…
                                        </>
                                    ) : (
                                        <>
                                            <FileSpreadsheet className="h-4 w-4" />
                                            Export selected month
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function ShirtTrackerPanel() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-display text-base font-semibold uppercase tracking-wide text-foreground">
                    Shirt Tracker
                </CardTitle>
                <CardDescription>
                    Track shirt pickup for all members with a submitted shirt size.
                    Toggle pickup status per row — changes sync instantly.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild variant="outline">
                    <Link href="/tools/shirt-tracker">
                        <Shirt className="h-4 w-4" />
                        Open Shirt Tracker
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}

function ConventionTrackerPanel() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-display text-base font-semibold uppercase tracking-wide text-foreground">
                    Convention Tracker
                </CardTitle>
                <CardDescription>
                    Track selected members&rsquo; National Convention eligibility —
                    volunteering, workshops, and general meetings attended out of 2
                    each.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild variant="outline">
                    <Link href="/tools/convention-tracker">
                        <Award className="h-4 w-4" />
                        Open Convention Tracker
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}

function InstagramPointsPanel() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-display text-base font-semibold uppercase tracking-wide text-foreground">
                    Instagram Points
                </CardTitle>
                <CardDescription>
                    Award +1 point to members who participated in Wear It
                    Wednesday on Instagram, and review award history.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild variant="outline">
                    <Link href="/tools/instagram-points">
                        <Instagram className="h-4 w-4" />
                        Open Instagram Points
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}

export default function ToolsPage() {
    return (
        <div className="mx-auto max-w-[1240px] px-10 py-8">
            <PageHeader eyebrow="Utilities" title="Tools" />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <AttendanceExportPanel />
                <ResumePanel />
                <ShirtTrackerPanel />
                <ConventionTrackerPanel />
                <InstagramPointsPanel />
            </div>

            {/* Port-vs-mobile-only decisions: docs/PARITY_DECISIONS.md (issue #10). */}
            <p className="mt-8 font-body text-xs text-[#A7A7A7]">
                Some officer workflows live only in the mobile app: committee join
                approvals, resume verification, Member of the Month, link &amp; feedback
                editors, and QR / manual event sign-in. Use the mobile officer hub for
                those.
            </p>
        </div>
    );
}
