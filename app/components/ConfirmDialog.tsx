"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

// Small confirm-dialog variant (DESIGN_BRIEF §5) for officer decisions and
// other one-step confirmations — e.g. deny a membership request, delete an
// event. `onConfirm` may be async; the confirm button shows a pending
// state and the dialog is blocked from closing while pending. Compare to
// the large FormDialog variant.
export default function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    variant = "default",
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: React.ReactNode;
    description?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "default" | "destructive";
    onConfirm: () => void | Promise<void>;
}) {
    const [pending, setPending] = React.useState(false);

    async function handleConfirm() {
        setPending(true);
        try {
            await onConfirm();
            onOpenChange(false);
        } finally {
            setPending(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (pending) return;
                onOpenChange(next);
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="font-display uppercase tracking-[0.02em]">
                        {title}
                    </DialogTitle>
                    {description ? (
                        <DialogDescription>{description}</DialogDescription>
                    ) : null}
                </DialogHeader>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={pending}
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        type="button"
                        variant={variant === "destructive" ? "destructive" : "default"}
                        onClick={handleConfirm}
                        disabled={pending}
                    >
                        {pending ? "Working…" : confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
