"use client";

import { formatTokenAmount } from "@conditional-stocks/domain";
import { parseAtomicPlan, parseOrder } from "@conditional-stocks/gateway";
import { Alert, AlertDescription, AlertTitle } from "@conditional-stocks/ui-kit/alert";
import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import { Input } from "@conditional-stocks/ui-kit/input";
import { Label } from "@conditional-stocks/ui-kit/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@conditional-stocks/ui-kit/select";
import { Separator } from "@conditional-stocks/ui-kit/separator";
import { Tabs, TabsList, TabsTrigger } from "@conditional-stocks/ui-kit/tabs";
import { CircleAlert, LoaderCircle, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { protocolConfig } from "@/config/protocol";
import { useTradingReadiness } from "@/hooks/useTradingReadiness";
import type { MarketView } from "@/lib/api/types";
import { DEMO_ACCOUNT, demoApprovalKey, reviewDemoOrder } from "@/lib/demo/engine";
import { formatNumber, formatUsd } from "@/lib/format/display";
import { logger } from "@/lib/logger";
import {
  atomicApproval,
  atomicSigningData,
  atomicTransaction,
  verifyAtomicResponse,
} from "@/lib/trading/atomic";
import { createOrder, previewOrder } from "@/lib/trading/order";

interface Preparation {
  funding: {
    approvalCall: { data: string; to: string } | null;
    approved: boolean;
    balanceSufficient: boolean;
    amount: string;
    assetKind: string;
  };
  notional: string;
  orderHash: string;
  order: ReturnType<typeof createOrder>;
  payoff: unknown;
  typedData: unknown;
  plan?: {
    guard: { nextSequence: string; makerFeeBps: number; takerFeeBps: number };
    releaseOrders: string[];
    makers: unknown[];
    quantities: string[];
    expectedRemaining: string[];
    deadline: string;
    filledQuantity: string;
    remainingQuantity: string;
    executionQuote: string;
  };
  atomicRouter?: string;
}
const asError = async (response: Response) => {
  logger.warn("order.request.failed", {
    status: response.status,
    requestId: response.headers.get("x-request-id"),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  return body.error?.message ?? `Request failed (${response.status})`;
};

export function OrderTicket({ market }: { market: MarketView }) {
  const wallet = useWallet();
  const demo = useDemo();
  const readiness = useTradingReadiness(market.id);
  const [branch, setBranch] = useState<"YES" | "NO">("YES");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [tif, setTif] = useState<"gtc" | "ioc">("gtc");
  const [funding, setFunding] = useState<"whole" | "claim">("whole");
  const book = branch === "YES" ? market.yes : market.no;
  const defaultPrice = side === "buy" ? book.bestAskExact : book.bestBidExact;
  const [quantity, setQuantity] = useState("1");
  const [maxFeeBps, setMaxFeeBps] = useState("0");
  const [price, setPrice] = useState(defaultPrice?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!preparation?.plan) return;
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [preparation]);
  const quoteExpired =
    !demo && preparation?.plan && BigInt(preparation.plan.deadline) <= BigInt(nowSeconds);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Wallet/market identity changes invalidate a previously reviewed transaction.
  useEffect(() => {
    setPreparation(null);
  }, [wallet.account, wallet.chainId, market.id]);
  const preview = useMemo(() => previewOrder(quantity, price, market), [price, quantity, market]);

  const order = () => {
    if (!wallet.account || !preview.valid)
      throw new Error("Connect your wallet and enter a valid quantity and price.");
    return createOrder(
      {
        baseTokenDecimals: market.baseTokenDecimals,
        quoteTokenDecimals: market.quoteTokenDecimals,
        protocolVersion: market.protocolVersion,
        priceFormat: market.priceFormat,
        account: wallet.account,
        branch,
        cutoff: market.cutoff,
        funding,
        marketId: market.id,
        maxFeeBps: demo ? 0 : maxFeeBps.trim() === "" ? Number.NaN : Number(maxFeeBps),
        price,
        quantity,
        side,
        tif,
      },
      demo ? { nowMs: demo.state.now } : {},
    );
  };

  const prepare = async () => {
    setBusy(true);
    try {
      if (!readiness.ready) throw new Error(readiness.reason);
      if (demo) {
        const candidate = order();
        const review = reviewDemoOrder(demo.state, candidate);
        setPreparation({
          funding: {
            ...review,
            assetKind: funding === "claim" ? "demo claim" : "demo token",
            approvalCall: review.approved ? null : { to: DEMO_ACCOUNT, data: "0x" },
          },
          order: candidate,
          orderHash: "demo-review",
          notional: preview.costRaw,
          payoff: null,
          typedData: null,
        });
        return;
      }
      if (wallet.chainId !== protocolConfig.chainId) await wallet.ensureNetwork();
      const token = wallet.sessionToken ?? (await wallet.authenticate());
      const candidate = order();
      const response = await fetch("/api/gateway/orders/prepare", {
        body: JSON.stringify({ order: candidate }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await asError(response));
      const result = (await response.json()) as Omit<Preparation, "order">;
      const plan = parseAtomicPlan(result.plan, parseOrder(candidate));
      setNowSeconds(Math.floor(Date.now() / 1000));
      setPreparation({
        ...result,
        order: candidate,
        plan: JSON.parse(
          JSON.stringify(plan, (_, value) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        ),
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Order preview failed");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!preparation?.funding.approvalCall) return;
    setBusy(true);
    try {
      if (demo) {
        demo.dispatch({ type: "approve", key: demoApprovalKey(preparation.order, demo.state) });
        toast.success("Demo funding approved. Review the current order to continue.");
        setPreparation(null);
        return;
      }
      const hash = await wallet.sendTransaction(
        atomicApproval({
          order: preparation.order,
          config: protocolConfig,
          market,
          response: preparation.funding.approvalCall,
        }),
      );
      toast.success(`Approval submitted: ${hash.slice(0, 10)}…`);
      setPreparation(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Approval rejected");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!preparation) return;
    setBusy(true);
    try {
      if (!readiness.ready) throw new Error(readiness.reason);
      if (demo) {
        const result = demo.dispatch({ type: "submit", order: preparation.order });
        const placed = result.orders.at(-1);
        toast.success(
          `Demo order ${placed?.status ?? "submitted"}. Balances and claims updated locally.`,
        );
        setPreparation(null);
        return;
      }
      if (!wallet.account || !preparation.plan)
        throw new Error("Review an atomic order quote first.");
      if (preparation.atomicRouter?.toLowerCase() !== protocolConfig.atomicRouter.toLowerCase())
        throw new Error("API atomic router differs from the configured deployment.");
      // The order signature and transaction are both constructed from the reviewed local order.
      // Neither a relay fallback nor a background settlement worker can change this plan.
      const signature = await wallet.signTypedData(
        atomicSigningData(preparation.order, protocolConfig),
      );
      const token = wallet.sessionToken ?? (await wallet.authenticate());
      const expected = atomicTransaction({
        order: preparation.order,
        plan: preparation.plan,
        signature,
        account: wallet.account,
        config: protocolConfig,
      });
      const response = await fetch("/api/gateway/orders/transaction", {
        body: JSON.stringify({ order: preparation.order, plan: preparation.plan, signature }),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await asError(response));
      const transaction = verifyAtomicResponse(expected, await response.json());
      // Recheck quote age after the API round trip; a wallet delay can still cause an onchain revert.
      atomicTransaction({
        order: preparation.order,
        plan: preparation.plan,
        signature,
        account: wallet.account,
        config: protocolConfig,
      });
      const hash = await wallet.sendTransaction(transaction);
      toast.success(
        `Atomic order submitted: ${hash.slice(0, 10)}… Fills and any remainder appear after indexing.`,
      );
      setPreparation(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Order submission failed");
    } finally {
      setBusy(false);
    }
  };

  const outcome = (wins: boolean) =>
    side === "buy"
      ? wins
        ? `${formatNumber(preview.qty)} ${market.ticker}`
        : funding === "whole"
          ? `${formatUsd(preview.cost)} cash claim`
          : "No payout (active claim only)"
      : wins
        ? `${formatUsd(preview.cost)} cash claim`
        : funding === "whole"
          ? `${formatNumber(preview.qty)} ${market.ticker}`
          : "No payout (active claim only)";
  const disabled = !readiness.ready || market.lifecycle !== "open" || !preview.valid;
  return (
    <Card className="overflow-visible">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trade conditional stock</CardTitle>
          <Badge variant="secondary">{demo ? "0% demo fee" : "Signed fee cap"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!readiness.ready && (
          <p role="status" className="text-sm text-warning">
            {readiness.reason}
          </p>
        )}
        <Tabs
          value={branch}
          onValueChange={(value) => {
            setBranch(value as "YES" | "NO");
            const nextBook = value === "YES" ? market.yes : market.no;
            setPrice((side === "buy" ? nextBook.bestAskExact : nextBook.bestBidExact) ?? "");
            setPreparation(null);
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="YES">
              <span className="size-2 rounded-full bg-trade-buy" />
              YES stock
            </TabsTrigger>
            <TabsTrigger value="NO">
              <span className="size-2 rounded-full bg-trade-sell" />
              NO stock
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs
          value={side}
          onValueChange={(value) => {
            setSide(value as "buy" | "sell");
            setPrice((value === "buy" ? book.bestAskExact : book.bestBidExact) ?? "");
            setPreparation(null);
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="sell">Sell</TabsTrigger>
          </TabsList>
        </Tabs>
        {!demo && (
          <div>
            <Label htmlFor="max-fee-bps">Maximum trading fee (bps)</Label>
            <Input
              id="max-fee-bps"
              type="number"
              min="0"
              max="1000"
              step="1"
              value={maxFeeBps}
              onChange={(event) => {
                setMaxFeeBps(event.target.value);
                setPreparation(null);
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              100 bps = 1%. Fees are deducted from received active claims. A fill above your signed
              cap reverts. Payoff amounts below are before fees; inactive claims are unaffected.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                setPreparation(null);
              }}
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="price">{tif === "ioc" ? "Worst price" : "Limit price"}</Label>
            <Input
              id="price"
              inputMode="decimal"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
                setPreparation(null);
              }}
              placeholder={defaultPrice?.toString() ?? "Required"}
              className="mt-2"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="order-tif">Time in force</Label>
            <Select
              value={tif}
              onValueChange={(value) => {
                setTif(value as "gtc" | "ioc");
                setPreparation(null);
              }}
            >
              <SelectTrigger id="order-tif" className="mt-2 w-full min-w-0">
                <SelectValue className="min-w-0 truncate">{tif.toUpperCase()}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gtc">GTC · rests until canceled</SelectItem>
                <SelectItem value="ioc">IOC · fill now or release</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="order-funding">Funding</Label>
            <Select
              value={funding}
              onValueChange={(value) => {
                setFunding(value as "whole" | "claim");
                setPreparation(null);
              }}
            >
              <SelectTrigger id="order-funding" className="mt-2 w-full min-w-0">
                <SelectValue className="min-w-0 truncate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whole">Whole token</SelectItem>
                <SelectItem value="claim">Active claim</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="rounded-xl bg-muted/55 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Maximum reservation</span>
            <span className="font-semibold">
              {side === "buy"
                ? formatUsd(preview.cost)
                : `${formatNumber(preview.qty)} ${market.ticker}`}
            </span>
          </div>
          <Separator className="my-3" />
          <p className="text-[10px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            If the market resolves
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-trade-buy/20 bg-card p-3">
              <span className="font-semibold text-trade-buy">YES</span>
              <p className="mt-1 leading-5">{outcome(branch === "YES")}</p>
            </div>
            <div className="rounded-lg border border-trade-sell/20 bg-card p-3">
              <span className="font-semibold text-trade-sell">NO</span>
              <p className="mt-1 leading-5">{outcome(branch === "NO")}</p>
            </div>
          </div>
        </div>
        {market.probability.quality !== "valid" && (
          <Alert variant="warning">
            <CircleAlert />
            <AlertTitle>Reference quality is {market.probability.quality}</AlertTitle>
            <AlertDescription>
              The informational probability is withheld until a fresh, deep, two-sided source
              snapshot is available. Stock orders use the independent branch order books.
            </AlertDescription>
          </Alert>
        )}
        {preparation && !preparation.funding.balanceSufficient && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Insufficient funding</AlertTitle>
            <AlertDescription>
              The canonical safe-block balance cannot cover this reservation.
            </AlertDescription>
          </Alert>
        )}
        {!demo && preparation?.plan && (
          <div className="rounded-xl border p-3 text-xs leading-5" aria-live="polite">
            <p>
              Atomic fill:{" "}
              {formatTokenAmount(BigInt(preparation.plan.filledQuantity), market.baseTokenDecimals)}{" "}
              {market.ticker} across {preparation.plan.makers.length} resting orders.
            </p>
            <p>
              {preparation.order.tif === 0 ? "Rests" : "Released"}:{" "}
              {formatTokenAmount(
                BigInt(preparation.plan.remainingQuantity),
                market.baseTokenDecimals,
              )}{" "}
              {market.ticker}.
            </p>
            <p>
              Execution value before fees:{" "}
              {formatTokenAmount(
                BigInt(preparation.plan.executionQuote),
                market.quoteTokenDecimals,
              )}{" "}
              USDG.
            </p>
            <p>
              {quoteExpired
                ? "Quote expired. Refresh before signing."
                : "All reviewed fills execute together or the transaction reverts. You pay gas, including for a reverted transaction."}
            </p>
            {preparation.plan.releaseOrders.length > 0 && (
              <p>
                This transaction also releases {preparation.plan.releaseOrders.length} stale orders
                to their owners to free risk-cap space. The additional gas is included in your
                transaction.
              </p>
            )}
            <p>
              If an individual payout is rejected, its recipient receives an exact-asset claim in
              the payout vault. Other payouts complete normally. Claim deferred payouts from
              Portfolio.
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={prepare} disabled={busy}>
              Refresh quote
            </Button>
          </div>
        )}
        {preparation?.funding.approvalCall ? (
          <Button className="w-full" size="lg" onClick={approve} disabled={busy}>
            <ShieldCheck />
            Approve {preparation.funding.assetKind.toUpperCase()}
          </Button>
        ) : preparation ? (
          <Button
            className="w-full"
            variant="brand"
            size="lg"
            onClick={submit}
            disabled={busy || Boolean(quoteExpired) || !preparation.funding.balanceSufficient}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            {demo ? "Submit demo order" : "Sign and place atomically"}
          </Button>
        ) : wallet.account ? (
          <Button
            className="w-full"
            variant="brand"
            size="lg"
            onClick={prepare}
            disabled={busy || disabled}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            {demo ? "Review demo order" : "Review canonical preview"}
          </Button>
        ) : (
          <Button
            className="w-full"
            size="lg"
            onClick={() => wallet.connect().catch(() => undefined)}
          >
            <WalletCards />
            Connect wallet to continue
          </Button>
        )}
        <p className="text-center text-[11px] leading-5 text-muted-foreground">
          {demo
            ? "Local simulation only. GTC rests against changing demo liquidity; IOC fills available depth and releases the remainder. No signature, gas or real assets."
            : "Your wallet signs the order and broadcasts one placement transaction containing its fills. GTC leaves any remainder resting; IOC refunds it. Approvals, if needed, are separate. Activity appears after chain confirmation."}
        </p>
      </CardContent>
    </Card>
  );
}
