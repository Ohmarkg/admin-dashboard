import Eyebrow from "@/components/Eyebrow";
import { cn } from "@/components/lib/utils";

// Page title block used at the top of every authenticated screen: eyebrow
// kicker + Oswald uppercase title + optional description + optional
// right-side action slot (buttons/toolbar). DESIGN_BRIEF §5, prototype
// dashboard header (`<x-dc>` "Chapter Operations" / "Good morning, Officers").
export default function PageHeader({
    eyebrow,
    title,
    description,
    actions,
    className,
}: {
    eyebrow?: React.ReactNode;
    title: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "mb-6 flex items-end justify-between gap-4",
                className
            )}
        >
            <div>
                {eyebrow ? <Eyebrow className="mb-[5px]">{eyebrow}</Eyebrow> : null}
                <h1 className="font-display text-[30px] font-semibold uppercase leading-none tracking-[0.02em] text-foreground">
                    {title}
                </h1>
                {description ? (
                    <p className="mt-2 font-sans text-sm text-muted-foreground">
                        {description}
                    </p>
                ) : null}
            </div>
            {actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
        </div>
    );
}
