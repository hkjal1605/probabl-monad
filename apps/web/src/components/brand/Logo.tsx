import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="inline-flex w-fit shrink-0 rounded-lg" href="/" aria-label="probabl home">
      {/* biome-ignore lint/performance/noImgElement: Exact shared transparent wordmark; an SVG needs no next/image optimization or runtime. */}
      <img
        src={compact ? "/brand/logo.svg" : "/brand/logo-name.svg"}
        alt="probabl"
        width={144}
        height={25}
        decoding="async"
        className={compact ? "size-8" : "h-auto w-28 sm:w-36"}
      />
    </Link>
  );
}
