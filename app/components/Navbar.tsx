"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOutUser } from "@/helpers/auth";
import { cn } from "@/components/lib/utils";

// Persistent top navbar for the authenticated shell (DESIGN_BRIEF §3, §5):
// maroon bar, 3px brand-dark bottom border, Oswald wordmark, nav links with
// active-state, sign-out control. Modeled on prototype/`SHPE Admin
// Portal.dc.html` NAVBAR section.
const NAV_LINKS = [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Events", href: "/events" },
    { label: "Points", href: "/points" },
    { label: "Membership", href: "/membership" },
    { label: "Committees", href: "/committees" },
    { label: "Tools", href: "/tools" },
] as const;

export default function Navbar() {
    const pathname = usePathname();
    const router = useRouter();

    const handleSignOut = async () => {
        await signOutUser();
        router.push("/");
    };

    return (
        <header className="flex h-14 flex-none items-center gap-[26px] border-b-[3px] border-brand-dark bg-brand px-[22px]">
            <div className="flex flex-none items-center gap-[10px]">
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-sm bg-white font-display text-base font-bold text-brand">
                    S
                </div>
                <div className="font-display text-[17px] font-semibold uppercase leading-none tracking-[0.04em] text-white">
                    TAMU SHPE <span className="font-normal text-[#E7B7B7]">Admin</span>
                </div>
            </div>

            <nav className="flex flex-1 items-center gap-1">
                {NAV_LINKS.map((link) => {
                    const active =
                        pathname === link.href || pathname?.startsWith(`${link.href}/`);
                    return (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={cn(
                                "rounded-sm px-[13px] py-2 font-display text-sm font-medium uppercase tracking-[0.05em] transition-colors",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-brand",
                                active
                                    ? "bg-brand-light text-white"
                                    : "text-white/70 hover:bg-brand-light/60 hover:text-white"
                            )}
                        >
                            {link.label}
                        </Link>
                    );
                })}
            </nav>

            <button
                type="button"
                onClick={handleSignOut}
                className={cn(
                    "flex-none whitespace-nowrap rounded-sm border border-white/35 bg-transparent px-[13px] py-[7px]",
                    "font-body text-xs font-semibold text-white transition-colors hover:border-brand-light hover:bg-brand-light",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
                )}
            >
                Sign out
            </button>
        </header>
    );
}
