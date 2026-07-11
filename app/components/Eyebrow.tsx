import { cn } from "@/components/lib/utils";

// Tiny uppercase Open Sans (font-body) label, wide letter-spacing, maroon —
// used as a section/kicker label above cards, tables, and page titles.
// DESIGN_BRIEF §2 "Signatures to borrow" / §5 component inventory.
export default function Eyebrow({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "font-body text-[11px] font-bold uppercase tracking-[0.2em] text-brand",
                className
            )}
        >
            {children}
        </div>
    );
}
