'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/config/firebaseClient";
import {
    signInWithGoogle,
    signInWithEmulatorAccount,
    checkHasRecognizedClaim,
    signOutUser,
} from "@/helpers/auth";

const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

export default function LoginPage() {
    const router = useRouter();
    const [denied, setDenied] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [emulatorEmail, setEmulatorEmail] = useState("shpe-officer@tamu.edu");
    const [emulatorPassword, setEmulatorPassword] = useState("");
    const [emulatorError, setEmulatorError] = useState<string | null>(null);

    // Already signed in with a recognized claim → skip straight to the dashboard.
    // Renders the login card immediately (no gating spinner) so the redirect is
    // a fast follow-up rather than blocking first paint.
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const hasClaim = await checkHasRecognizedClaim(user);
                if (hasClaim) {
                    router.push("/dashboard");
                }
            }
        });

        return () => unsubscribe();
    }, [router]);

    const handleGoogleSignIn = async () => {
        setSubmitting(true);
        setDenied(false);
        try {
            const result = await signInWithGoogle();
            const hasClaim = await checkHasRecognizedClaim(result.user);
            if (hasClaim) {
                router.push("/dashboard");
            } else {
                await signOutUser();
                setDenied(true);
            }
        } catch (error) {
            console.error("Google sign-in error:", error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleEmulatorSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setDenied(false);
        setEmulatorError(null);
        try {
            const result = await signInWithEmulatorAccount(emulatorEmail, emulatorPassword);
            const hasClaim = await checkHasRecognizedClaim(result.user);
            if (hasClaim) {
                router.push("/dashboard");
            } else {
                await signOutUser();
                setDenied(true);
            }
        } catch (error) {
            console.error("Emulator sign-in error:", error);
            setEmulatorError("Sign-in failed. Check the email/password.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main
            className="relative flex min-h-screen items-center justify-center overflow-hidden"
            style={{ background: "radial-gradient(120% 100% at 50% 0%, #732F2F 0%, #500000 45%, #3C001C 100%)" }}
        >
            {/* Subtle ghost monogram — login screen only, per DESIGN_BRIEF §4.0 */}
            <div
                className="pointer-events-none absolute -bottom-36 -right-24 select-none font-bold leading-none"
                style={{ fontFamily: "Oswald, sans-serif", fontSize: "520px", color: "rgba(255,255,255,0.035)" }}
                aria-hidden="true"
            >
                AM
            </div>

            <div className="relative w-[420px] max-w-[90vw] rounded px-10 pb-9 pt-10 text-center shadow-2xl" style={{ background: "#FFFFFF" }}>
                <div className="mb-6 flex items-center justify-center gap-2.5">
                    <div
                        className="flex h-10 w-10 items-center justify-center rounded font-bold text-white"
                        style={{ background: "#500000", fontFamily: "Oswald, sans-serif", fontSize: "20px" }}
                    >
                        S
                    </div>
                    <div
                        className="flex h-10 w-10 items-center justify-center rounded-full border-2 font-bold"
                        style={{ borderColor: "#500000", color: "#500000", fontFamily: "Oswald, sans-serif", fontSize: "16px" }}
                    >
                        A&amp;M
                    </div>
                </div>

                <div
                    className="mb-2 font-bold uppercase"
                    style={{ color: "#732F2F", fontFamily: "Open Sans, sans-serif", fontSize: "11px", letterSpacing: ".24em" }}
                >
                    Officer Access
                </div>

                <h1
                    className="mb-2.5 font-semibold uppercase"
                    style={{ color: "#202020", fontFamily: "Oswald, sans-serif", fontSize: "27px", lineHeight: 1.05, letterSpacing: ".02em" }}
                >
                    TAMU SHPE
                    <br />
                    Admin Portal
                </h1>

                <p
                    className="mb-6 italic"
                    style={{ color: "#626262", fontFamily: "'Crimson Text', Georgia, serif", fontSize: "16px" }}
                >
                    For authorized officers of the Aggie SHPE family.
                </p>

                {denied && (
                    <div
                        className="mb-4 rounded border px-3.5 py-3 text-left"
                        style={{ background: "#FEF2F2", borderColor: "#FCA5A5" }}
                    >
                        <div className="mb-0.5 text-sm font-semibold" style={{ color: "#B91C1C" }}>
                            Access denied
                        </div>
                        <div className="text-sm leading-snug" style={{ color: "#626262" }}>
                            Your account isn&apos;t authorized for this portal.{" "}
                            <button
                                type="button"
                                onClick={() => setDenied(false)}
                                className="font-semibold underline"
                                style={{ color: "#500000" }}
                            >
                                Try another account
                            </button>
                        </div>
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2.5 rounded py-3.5 font-medium uppercase text-white transition-colors disabled:opacity-60"
                    style={{ background: "#500000", fontFamily: "Oswald, sans-serif", fontSize: "15px", letterSpacing: ".08em" }}
                >
                    <span
                        className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white font-bold"
                        style={{ color: "#500000", fontFamily: "Open Sans, sans-serif", fontSize: "11px" }}
                    >
                        G
                    </span>
                    Sign in with TAMU Google
                </button>

                {useEmulators && (
                    <form onSubmit={handleEmulatorSignIn} className="mt-5 space-y-2 border-t pt-5 text-left" style={{ borderColor: "#EAEAEA" }}>
                        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#A7A7A7" }}>
                            Dev only — Emulator sign-in
                        </div>
                        <input
                            type="email"
                            value={emulatorEmail}
                            onChange={(e) => setEmulatorEmail(e.target.value)}
                            placeholder="shpe-officer@tamu.edu"
                            className="w-full rounded border px-3 py-2 text-sm outline-none"
                            style={{ borderColor: "#D1D1D1" }}
                        />
                        <input
                            type="password"
                            value={emulatorPassword}
                            onChange={(e) => setEmulatorPassword(e.target.value)}
                            placeholder="testpassword"
                            className="w-full rounded border px-3 py-2 text-sm outline-none"
                            style={{ borderColor: "#D1D1D1" }}
                        />
                        {emulatorError && (
                            <div className="text-xs" style={{ color: "#B91C1C" }}>
                                {emulatorError}
                            </div>
                        )}
                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full rounded border py-2 text-sm font-semibold disabled:opacity-60"
                            style={{ borderColor: "#500000", color: "#500000" }}
                        >
                            Sign in (emulator)
                        </button>
                    </form>
                )}
            </div>
        </main>
    );
}
