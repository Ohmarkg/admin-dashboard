import { Oswald, Work_Sans, Open_Sans, Crimson_Text } from "next/font/google";

// Oswald — display voice: page titles, section headers, navbar wordmark,
// big stat numbers, button labels (uppercase + slight letter-spacing).
export const oswald = Oswald({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700"],
    variable: "--font-oswald",
    display: "swap",
});

// Work Sans — primary body & interface reading voice.
export const workSans = Work_Sans({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700"],
    style: ["normal", "italic"],
    variable: "--font-work-sans",
    display: "swap",
});

// Open Sans — utility voice: table content, data cells, captions, badges.
// Paired with tabular figures for numeric columns (points spreadsheet etc).
export const openSans = Open_Sans({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
    variable: "--font-open-sans",
    display: "swap",
});

// Crimson Text — editorial accent only (login tagline, empty-state lines).
export const crimsonText = Crimson_Text({
    subsets: ["latin"],
    weight: ["400"],
    style: ["normal", "italic"],
    variable: "--font-crimson-text",
    display: "swap",
});

// Convenience export: spread onto <html>/<body> className to expose all
// four font CSS variables at once.
export const fontVariables = [
    oswald.variable,
    workSans.variable,
    openSans.variable,
    crimsonText.variable,
].join(" ");
