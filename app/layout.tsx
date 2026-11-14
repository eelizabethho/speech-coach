import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const display = Geist({ subsets: ["latin"], weight: ["300", "400"], variable: "--font-display" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Runs before paint so a stored light/dark choice never flashes the other theme.
const themeScript = `try{var t=localStorage.getItem("speech-coach:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "Speech Coach",
  description: "Practice interviews out loud with an AI interviewer.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
