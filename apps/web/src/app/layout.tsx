import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "@/styles/global.css";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { TestnetBanner } from "@/components/onboarding/TestnetBanner";
import { AppProviders } from "@/components/providers/AppProviders";
import { API_URL } from "@/services/constants";

const aeonik = localFont({
  src: [
    { path: "../styles/fonts/aeonik-pro-regular.woff2", weight: "400", style: "normal" },
    { path: "../styles/fonts/aeonik-pro-medium.woff2", weight: "500", style: "normal" },
    { path: "../styles/fonts/aeonik-pro-bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-aeonik",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "probabl — Event-driven stock markets", template: "%s · probabl" },
  applicationName: "probabl",
  description:
    "Trade conditional stock values across clear YES and NO event outcomes with onchain settlement.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://probabl.trade"),
  openGraph: {
    siteName: "probabl",
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: "probabl — Event-driven stock markets" },
    ],
  },
  icons: { icon: "/brand/favicon.svg", apple: "/brand/apple-touch-icon.png" },
};
export const viewport: Viewport = { colorScheme: "light dark" };
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={aeonik.variable}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href={API_URL} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={API_URL} />
      </head>
      <body className="flex min-h-dvh flex-col text-sm">
        <AppProviders>
          <SiteHeader />
          <TestnetBanner />
          {children}
          <SiteFooter />
        </AppProviders>
      </body>
    </html>
  );
}
