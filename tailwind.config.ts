import type { Config } from "tailwindcss";

// Brand theme tokens (DESIGN_BRIEF.md §2): Aggie maroon family + neutral
// grays, wired into shadcn's CSS-variable convention, plus a few
// non-shadcn brand tokens (brand.*, gold) exposed directly as colors.
const config: Config = {
    darkMode: ["class"],
    content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
    theme: {
        container: {
            center: true,
            padding: "2rem",
            screens: {
                "2xl": "1400px",
            },
        },
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                // Non-shadcn brand tokens (DESIGN_BRIEF §2) — used directly
                // as e.g. `bg-brand`, `text-brand-dark`, `bg-gold`.
                brand: {
                    DEFAULT: "#500000",
                    dark: "#3C001C",
                    light: "#732F2F",
                },
                gold: "#FCE300",
            },
            fontFamily: {
                display: ["var(--font-oswald)", "sans-serif"],
                sans: ["var(--font-work-sans)", "system-ui", "sans-serif"],
                body: ["var(--font-open-sans)", "system-ui", "sans-serif"],
                serif: ["var(--font-crimson-text)", "Georgia", "serif"],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
};

export default config;
