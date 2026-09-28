import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "@/styles/global.css";
import { AdminShell } from "@/components/layout/AdminShell";
import { AdminProvider } from "@/components/providers/AdminProvider";

const aeonik = localFont({
  src: [
    { path: "../../../web/src/styles/fonts/Aeonik Pro Light.ttf", weight: "300", style: "normal" },
    {
      path: "../../../web/src/styles/fonts/Aeonik Pro Regular.ttf",
      weight: "400",
      style: "normal",
    },
    { path: "../../../web/src/styles/fonts/Aeonik Pro Medium.ttf", weight: "500", style: "normal" },
    { path: "../../../web/src/styles/fonts/Aeonik Pro Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-aeonik",
  display: "swap",
});
export const metadata: Metadata = {
  title: { default: "probabl · Operations", template: "%s · probabl Operations" },
  applicationName: "probabl",
  description: "Manual market and resolution operations for probabl.",
  metadataBase: new URL("https://operations.conditional.exchange"),
  openGraph: {
    description: "Manual market and resolution operations for probabl.",
    images: [{ height: 630, url: "/og.png", width: 1200, alt: "probabl — Operations" }],
    title: "probabl · Operations",
    siteName: "probabl",
    type: "website",
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
      <body className="text-sm">
        <AdminProvider>
          <AdminShell>{children}</AdminShell>
        </AdminProvider>
      </body>
    </html>
  );
}
