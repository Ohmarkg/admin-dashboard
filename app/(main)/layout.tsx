'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/config/firebaseClient";
import { checkHasRecognizedClaim } from "@/helpers/auth";
import Navbar from "@/components/Navbar";

// Auth-guarded shell for all authenticated screens.
export default function MainLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                router.push("/");
                return;
            }

            const hasClaim = await checkHasRecognizedClaim(user);
            if (!hasClaim) {
                router.push("/");
                return;
            }

            setAuthorized(true);
            setChecking(false);
        });

        return () => unsubscribe();
    }, [router]);

    if (checking || !authorized) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-white">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#500000]/30 border-t-[#500000]" />
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <Navbar />
            {children}
        </div>
    );
}
