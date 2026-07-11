"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/components/lib/utils";

// Large form-dialog variant used for multi-field forms (event create/edit
// and similar) — DESIGN_BRIEF §5, prototype "EVENT MODAL": maroon header
// band with eyebrow + Oswald uppercase title, scrollable body, footer slot
// for actions (Cancel / Save). Compare to the small ConfirmDialog variant.
export default function FormDialog({
    open,
    onOpenChange,
    title,
    eyebrow,
    children,
    footer,
    className,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: React.ReactNode;
    eyebrow?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPortal>
                <DialogOverlay className="bg-brand-dark/40 backdrop-blur-[3px]" />
                <DialogPrimitive.Content
                    className={cn(
                        "fixed left-1/2 top-9 z-50 flex max-h-[calc(100vh-4.5rem)] w-full max-w-3xl -translate-x-1/2 flex-col overflow-hidden rounded-md bg-background shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                        className
                    )}
                >
                    <div className="flex flex-none items-center justify-between bg-brand px-6 py-4 text-white">
                        <div>
                            {eyebrow ? (
                                <div className="mb-0.5 font-body text-[10px] font-bold uppercase tracking-[0.16em] text-[#E7B7B7]">
                                    {eyebrow}
                                </div>
                            ) : null}
                            <DialogPrimitive.Title className="font-display text-xl font-semibold uppercase tracking-[0.02em]">
                                {title}
                            </DialogPrimitive.Title>
                        </div>
                        <DialogPrimitive.Close className="rounded-sm text-white/80 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                            <X className="h-5 w-5" />
                            <span className="sr-only">Close</span>
                        </DialogPrimitive.Close>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
                    {footer ? (
                        <div className="flex flex-none items-center justify-end gap-3 border-t border-border px-6 py-4">
                            {footer}
                        </div>
                    ) : null}
                </DialogPrimitive.Content>
            </DialogPortal>
        </Dialog>
    );
}
