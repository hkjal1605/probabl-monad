import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t bg-card/40">
      <div className="mx-auto grid w-full max-w-[1280px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <Logo />
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
            Trade a stock token at different values depending on how a real-world event resolves.
            Orders are signed offchain and enforced onchain; v1 markets are created and resolved
            manually by protocol admins.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-3 text-sm text-muted-foreground md:justify-end">
          <Link href="/learn" className="hover:text-foreground">
            Risks & mechanics
          </Link>
          <Link href="/resolution" className="hover:text-foreground">
            Resolution center
          </Link>
          <Link href="/funds" className="hover:text-foreground">
            Funds
          </Link>
        </div>
      </div>
    </footer>
  );
}
