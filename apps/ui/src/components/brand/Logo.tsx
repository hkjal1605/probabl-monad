import { BrandLogo } from "@conditional-stocks/ui-kit/brand-logo";
import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="inline-flex w-fit shrink-0 rounded-lg" href="/" aria-label="probabl home">
      <BrandLogo compact={compact} />
    </Link>
  );
}
