import { BookOpenCheck, GitBranch, ScanSearch } from "lucide-react";

const steps = [
  {
    icon: ScanSearch,
    number: "01",
    title: "Read one precise event",
    body: "Start with the exact Polymarket question, source, cutoff, and resolution rules—not a headline shorthand.",
  },
  {
    icon: GitBranch,
    number: "02",
    title: "Choose a stock branch",
    body: "Trade the stock claim that pays if YES wins or the complementary stock claim that pays if NO wins.",
  },
  {
    icon: BookOpenCheck,
    number: "03",
    title: "Control the execution",
    body: "Use an explicit limit or IOC worst price. The ticket shows reservation, likely fills, and both outcome payoffs before signing.",
  },
];
export function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
      <div className="max-w-2xl">
        <p className="text-xs font-bold tracking-[0.12em] text-brand-strong uppercase">
          A clearer mental model
        </p>
        <h2 className="mt-4 font-display text-4xl leading-none font-medium tracking-[-0.055em] sm:text-6xl">
          Event first. Branch second. Price last.
        </h2>
        <p className="mt-5 text-base leading-7 text-muted-foreground">
          The interface reveals complexity in that order, keeping mechanics available without
          putting an order book between you and the core decision.
        </p>
      </div>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {steps.map((step) => (
          <article key={step.number} className="rounded-2xl border bg-card p-6 shadow-soft">
            <div className="flex items-center justify-between">
              <step.icon className="text-brand-strong" />
              <span className="font-mono text-xs text-muted-foreground">{step.number}</span>
            </div>
            <h3 className="mt-10 text-xl font-semibold">{step.title}</h3>
            <p className="mt-3 leading-7 text-muted-foreground">{step.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
