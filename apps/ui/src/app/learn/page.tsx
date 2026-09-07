import { Alert, AlertDescription, AlertTitle } from "@conditional-stocks/ui-kit/alert";
import { Card, CardContent } from "@conditional-stocks/ui-kit/card";
import { AlertTriangle, Combine, FileCheck2, GitBranch, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "How it works" };
const sections = [
  {
    icon: GitBranch,
    title: "One whole token becomes two event claims",
    body: "A Stock Token can split into Stock-YES and Stock-NO. USDG can split into Cash-YES and Cash-NO. The two index sets are complementary and fixed at market creation.",
  },
  {
    icon: ShieldCheck,
    title: "Two independent stock order books",
    body: "In the YES book, buyers exchange Cash-YES for Stock-YES. In the NO book, buyers exchange Cash-NO for Stock-NO. A quote in one branch says nothing about available liquidity in the other.",
  },
  {
    icon: Combine,
    title: "Complementary claims can merge",
    body: "Before resolution, matching YES and NO claims for the same collateral can merge back into the whole token. After resolution, winning claims redeem against the local payout vector.",
  },
  {
    icon: FileCheck2,
    title: "Resolution is manual in v1",
    body: "Admins collect Polymarket and Polygon evidence, a separate reviewer approves the packet, and a multisig executes the exact reviewed transaction. The app then verifies the canonical indexed result.",
  },
];
export default function LearnPage() {
  return (
    <main className="mx-auto w-full max-w-[960px] px-5 py-14 sm:px-8">
      <p className="text-xs font-bold tracking-[0.12em] text-brand-strong uppercase">
        Product mechanics
      </p>
      <h1 className="mt-4 font-display text-5xl font-medium tracking-[-0.06em] sm:text-6xl">
        What you own in every outcome.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
        Positions on probabl are tokenized payoff claims, not ordinary shares and not Polymarket
        outcome tokens.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardContent>
              <section.icon className="text-brand-strong" />
              <h2 className="mt-7 text-xl font-semibold">{section.title}</h2>
              <p className="mt-3 leading-7 text-muted-foreground">{section.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Alert variant="warning" className="mt-6">
        <AlertTriangle />
        <AlertTitle>Technical and product risk</AlertTitle>
        <AlertDescription>
          Conditional claims can become worthless, liquidity can disappear, transactions can fail or
          reorganize, and manual resolution may take time. Reference probability is informational
          only. Review the exact market terms and size positions you can afford to lose.
        </AlertDescription>
      </Alert>
      <div className="mt-10 rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Direct recovery</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          If this interface is unavailable, you can still use the deployed Conditional Tokens
          contract to merge complementary positions or redeem finalized winning positions. Keep the
          market condition ID, collateral token address, index sets, and deployment manifest. The
          web app is a convenience layer, not a custody boundary.
        </p>
      </div>
    </main>
  );
}
