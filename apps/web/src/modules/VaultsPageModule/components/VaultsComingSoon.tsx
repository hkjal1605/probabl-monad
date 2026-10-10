import { ArrowRight, Coins, Scale, Sparkles, Vault } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Scale,
    title: "Neutral on the event",
    body: "A vault quotes YES and NO on every event it covers, so it takes no side on the outcome.",
  },
  {
    icon: Coins,
    title: "Earns the spread",
    body: "Fills on both sides of the book turn the bid–ask spread into returns for depositors.",
  },
  {
    icon: Vault,
    title: "Holds its stock",
    body: "Deposit once: the vault keeps its stock and puts it to work across every market.",
  },
] as const;

/** Decorative: a vault door whose dial turns, YES and NO quotes on its orbit. */
function VaultIllustration() {
  const center = 160;
  const point = (radius: number, degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
  };
  return (
    <svg
      viewBox="0 0 320 320"
      aria-hidden="true"
      className="size-64 overflow-visible sm:size-80"
      fontFamily="inherit"
    >
      <defs>
        <radialGradient id="vaults-glow">
          <stop offset="0%" style={{ stopColor: "var(--primary)", stopOpacity: 0.32 }} />
          <stop offset="70%" style={{ stopColor: "var(--primary)", stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <circle
        cx={center}
        cy={center}
        r={160}
        fill="url(#vaults-glow)"
        className="animate-[pulse_4s_ease-in-out_infinite] motion-reduce:animate-none"
      />

      {/* The orbit and its satellites drift around the door. */}
      <g className="origin-[160px_160px] animate-[spin_60s_linear_infinite] motion-reduce:animate-none">
        <circle
          cx={center}
          cy={center}
          r={134}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="2 8"
          strokeLinecap="round"
          className="stroke-border"
        />
        <circle cx={center} cy={26} r={5} className="fill-primary" />
        <circle cx={294} cy={center} r={3.5} className="fill-positive" />
        <circle cx={26} cy={center} r={3.5} className="fill-danger" />
      </g>

      {/* The door, its rim and bolts. */}
      <circle cx={center} cy={center} r={100} strokeWidth={2} className="fill-card stroke-border" />
      <circle
        cx={center}
        cy={center}
        r={84}
        fill="none"
        strokeWidth={1.5}
        className="stroke-border"
      />
      {Array.from({ length: 12 }, (_, index) => index * 30).map((degrees) => {
        const { x, y } = point(92, degrees);
        return <circle key={degrees} cx={x} cy={y} r={2.5} className="fill-muted-foreground/50" />;
      })}

      {/* The dial turns slowly: ticks, then a three-spoke handle. */}
      <g className="origin-[160px_160px] animate-[spin_24s_linear_infinite] motion-reduce:animate-none">
        {Array.from({ length: 24 }, (_, index) => index * 15).map((degrees) => {
          const major = degrees % 45 === 0;
          const inner = point(major ? 60 : 64, degrees);
          const outer = point(70, degrees);
          return (
            <line
              key={degrees}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              strokeWidth={major ? 2 : 1}
              strokeLinecap="round"
              className="stroke-muted-foreground/60"
            />
          );
        })}
        {[0, 60, 120].map((degrees) => {
          const from = point(54, degrees);
          const to = point(54, degrees + 180);
          return (
            <g key={degrees}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                strokeWidth={6}
                strokeLinecap="round"
                className="stroke-foreground/80"
              />
              <circle cx={from.x} cy={from.y} r={7} className="fill-primary" />
              <circle cx={to.x} cy={to.y} r={7} className="fill-primary" />
            </g>
          );
        })}
      </g>
      <circle
        cx={center}
        cy={center}
        r={32}
        strokeWidth={3}
        className="fill-background stroke-primary"
      />
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={34}
        fontWeight={600}
        className="fill-foreground"
      >
        Δ
      </text>

      {/* Quotes on both outcomes, and the spread they earn. */}
      <g className="animate-[pulse_3s_ease-in-out_infinite] motion-reduce:animate-none">
        <rect
          x={6}
          y={70}
          width={70}
          height={28}
          rx={14}
          className="fill-positive-soft stroke-positive/40"
        />
        <text
          x={41}
          y={84}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={600}
          className="fill-positive"
        >
          YES
        </text>
      </g>
      <g className="animate-[pulse_3s_ease-in-out_1.5s_infinite] motion-reduce:animate-none">
        <rect
          x={244}
          y={222}
          width={70}
          height={28}
          rx={14}
          className="fill-danger-soft stroke-danger/40"
        />
        <text
          x={279}
          y={236}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={600}
          className="fill-danger"
        >
          NO
        </text>
      </g>
      <g className="animate-[pulse_3s_ease-in-out_0.75s_infinite] motion-reduce:animate-none">
        <rect x={226} y={44} width={86} height={28} rx={14} className="fill-primary" />
        <text
          x={269}
          y={58}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={600}
          className="fill-primary-foreground"
        >
          + spread
        </text>
      </g>
    </svg>
  );
}

export function VaultsComingSoon() {
  return (
    <section
      aria-labelledby="vaults-coming-soon"
      className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center gap-8 py-10 text-center"
    >
      <VaultIllustration />
      <div className="flex max-w-2xl flex-col items-center gap-4">
        <Badge variant="positive" className="gap-1.5">
          <Sparkles aria-hidden="true" />
          Coming soon
        </Badge>
        <h1
          id="vaults-coming-soon"
          className="text-balance text-4xl font-medium tracking-tight sm:text-5xl"
        >
          Δ-Vaults are on their way
        </h1>
        <p className="max-w-xl text-balance text-base text-muted-foreground">
          Provide liquidity to conditional stock markets without picking a side. Deposit into a
          vault and it quotes every outcome of the events it covers for you.
        </p>
      </div>
      <ul className="grid w-full max-w-3xl list-none gap-3 text-left sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex flex-col gap-3 rounded-xl bg-card p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-positive-soft text-positive">
              <Icon aria-hidden="true" className="size-4.5" />
            </span>
            <span className="font-medium text-foreground">{title}</span>
            <span className="text-sm text-muted-foreground">{body}</span>
          </li>
        ))}
      </ul>
      <Button size="lg" render={<Link href="/" />} nativeButton={false}>
        Explore markets
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </section>
  );
}
