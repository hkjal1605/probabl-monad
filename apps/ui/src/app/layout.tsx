import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/styles/global.css";
import { ModeBar } from "@/components/demo/ModeBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AppProviders } from "@/components/providers/AppProviders";
import { protocolConfig } from "@/config/protocol";
import { appMode } from "@/lib/demo/server";

export const metadata: Metadata = {
  title: { default: "probabl — Event-driven stock markets", template: "%s · probabl" },
  applicationName: "probabl",
  description:
    "Trade conditional stock values across clear YES and NO event outcomes with onchain settlement.",
  metadataBase: new URL("https://conditional.exchange"),
  openGraph: {
    siteName: "probabl",
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: "probabl — Event-driven stock markets" },
    ],
  },
  icons: { icon: "/brand/favicon.svg", apple: "/brand/apple-touch-icon.png" },
};
export const viewport: Viewport = { colorScheme: "light dark" };
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const mode = await appMode();
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <AppProviders mode={mode} key={mode}>
          <SiteHeader />
          <ModeBar />
          {mode === "live" && protocolConfig.chainId === 4663 && (
            <div role="note" className="bg-warning-soft px-5 py-2 text-center text-sm text-warning">
              Internal mainnet testing · Real assets at risk · Not approved for public production
            </div>
          )}
          {children}
          <SiteFooter />
        </AppProviders>
      </body>
    </html>
  );
}
