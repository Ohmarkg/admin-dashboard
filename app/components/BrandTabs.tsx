"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/components/lib/utils";

export type BrandTabItem = {
    value: string;
    label: React.ReactNode;
    content?: React.ReactNode;
};

// Thin, brand-styled wrapper over ui/tabs: underline-style tab strip
// (Oswald uppercase labels, 3px maroon underline on the active tab, gray
// on inactive) per DESIGN_BRIEF §5 / prototype membership tabs
// (`memTabs`). Pass `tabs` with `content` for a fully self-contained tab
// set, or omit `content` and render `<TabsContent value="...">` children
// yourself for more control over layout.
export default function BrandTabs({
    tabs,
    value,
    defaultValue,
    onValueChange,
    children,
    className,
    listClassName,
}: {
    tabs: BrandTabItem[];
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
    className?: string;
    listClassName?: string;
}) {
    return (
        <Tabs
            value={value}
            defaultValue={defaultValue ?? tabs[0]?.value}
            onValueChange={onValueChange}
            className={className}
        >
            <TabsPrimitive.List
                className={cn(
                    "flex items-end gap-1 border-b border-border",
                    listClassName
                )}
            >
                {tabs.map((tab) => (
                    <TabsPrimitive.Trigger
                        key={tab.value}
                        value={tab.value}
                        className={cn(
                            "-mb-px border-b-[3px] border-transparent px-4 pb-[10px] pt-[11px] font-display text-[15px] font-medium uppercase tracking-[0.03em] text-muted-foreground transition-colors",
                            "data-[state=active]:border-brand data-[state=active]:text-brand",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        )}
                    >
                        {tab.label}
                    </TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>
            {tabs.some((tab) => tab.content !== undefined)
                ? tabs.map((tab) =>
                      tab.content !== undefined ? (
                          <TabsContent key={tab.value} value={tab.value}>
                              {tab.content}
                          </TabsContent>
                      ) : null
                  )
                : children}
        </Tabs>
    );
}
