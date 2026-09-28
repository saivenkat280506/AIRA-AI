import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LearnedTodayProvider } from "@/components/LearnedToday";
import { SiteHeader } from "@/components/SiteHeader";
import { Toaster } from "@/components/Toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AIRA — Adaptive Incident Response Agent",
  description:
    "AI agent that resolves production incidents faster by remembering every past incident, root cause and proven fix — powered by Hindsight memory and Groq.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col font-sans">
        <LearnedTodayProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
            {children}
          </main>
          <footer className="border-t border-border/70 py-4 text-center text-[11px] text-muted-foreground">
            AIRA · Adaptive Incident Response Agent — Hindsight memory × Groq
          </footer>
        </LearnedTodayProvider>
        <Toaster />
      </body>
    </html>
  );
}
