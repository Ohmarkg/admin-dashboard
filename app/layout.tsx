import type { Metadata } from "next";
import "./globals.css";
import Providers from "./components/Providers";
import { Toaster } from "./components/ui/sonner";
import { fontVariables } from "./fonts";

export const metadata: Metadata = {
    title: "TAMU SHPE Admin",
    description: "Internal admin portal for the Texas A&M SHPE chapter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={fontVariables}>
            {/* Extensions (e.g. Grammarly) inject attributes onto <body> before
                hydration; suppress so that mismatch doesn't spam the overlay. */}
            <body suppressHydrationWarning>
                <Providers>{children}</Providers>
                <Toaster />
            </body>
        </html>
    );
}
