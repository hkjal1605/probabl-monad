"use client";

import { Button } from "@conditional-stocks/ui-kit/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@conditional-stocks/ui-kit/sheet";
import { ThemeSelect } from "@conditional-stocks/ui-kit/theme";
import { cn } from "@conditional-stocks/ui-kit/utils";
import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { WalletButton } from "@/components/wallet/WalletButton";

const navigation = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/orders", label: "Orders" },
  { href: "/resolution", label: "Resolution" },
  { href: "/learn", label: "How it works" },
];
export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/82 backdrop-blur-xl">
      <div className="mx-auto flex h-18 w-full max-w-[1280px] items-center gap-2 px-4 sm:px-8">
        <Logo />
        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Main navigation">
          {navigation.map((item) => (
            <Button
              key={item.href}
              asChild
              variant="ghost"
              size="sm"
              className={cn(
                (pathname === item.href || pathname.startsWith(`${item.href}/`)) &&
                  "bg-accent text-accent-foreground",
              )}
            >
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSelect />
          <div className="hidden sm:block">
            <WalletButton />
          </div>
          <div className="sm:hidden">
            <WalletButton compact />
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>
                  <Logo />
                </SheetTitle>
                <SheetDescription>Explore probabl</SheetDescription>
              </SheetHeader>
              <nav className="mt-8 flex flex-col gap-2" aria-label="Mobile navigation">
                {navigation.map((item) => (
                  <SheetClose asChild key={item.href}>
                    <Button
                      asChild
                      variant={pathname.startsWith(item.href) ? "secondary" : "ghost"}
                      className="h-12 justify-start"
                    >
                      <Link href={item.href}>{item.label}</Link>
                    </Button>
                  </SheetClose>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
