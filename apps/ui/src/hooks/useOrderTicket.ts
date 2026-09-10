"use client";
import { parseAtomicPlan, parseOrder } from "@conditional-stocks/gateway";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { protocolConfig } from "@/config/protocol";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useTradingReadiness } from "@/hooks/useTradingReadiness";
import { api } from "@/lib/api/client";
import type { MarketView } from "@/lib/api/types";
import { DEMO_ACCOUNT, demoApprovalKey, reviewDemoOrder } from "@/lib/demo/engine";
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
export function useOrderTicket({ market }: { market: MarketView }) {
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
  const { busy, run } = useAsyncAction(
    [
      wallet.account,
      market.id,
      branch,
      side,
      tif,
      funding,
      quantity,
      price,
      maxFeeBps,
      market.baseStep,
      market.baseToken,
      market.quoteToken,
    ].join(":"),
  );
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
  }, [
    wallet.account,
    wallet.chainId,
    market.id,
    branch,
    side,
    tif,
    funding,
    quantity,
    price,
    maxFeeBps,
  ]);
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
        baseStep: market.baseStep,
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

  const prepare = () =>
    run(async (assertCurrent) => {
      setPreparation(null);
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
      assertCurrent();
      const candidate = order();
      const result = await api.prepare<Omit<Preparation, "order">>(
        "orders/prepare",
        { order: candidate },
        token,
      );
      const plan = parseAtomicPlan(result.plan, parseOrder(candidate));
      assertCurrent();
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
    });

  const approve = () =>
    run(async (assertCurrent) => {
      if (!preparation?.funding.approvalCall) return;
      if (demo) {
        demo.dispatch({ type: "approve", key: demoApprovalKey(preparation.order, demo.state) });
        toast.success("Demo funding approved. Review the current order to continue.");
        setPreparation(null);
        return;
      }
      assertCurrent();
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
    });

  const submit = () =>
    run(async (assertCurrent) => {
      if (!preparation) return;
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
      assertCurrent();
      const token = wallet.sessionToken ?? (await wallet.authenticate());
      assertCurrent();
      const expected = atomicTransaction({
        order: preparation.order,
        plan: preparation.plan,
        signature,
        account: wallet.account,
        config: protocolConfig,
      });
      const response = await api.prepare<unknown>(
        "orders/transaction",
        { order: preparation.order, plan: preparation.plan, signature },
        token,
      );
      const transaction = verifyAtomicResponse(expected, response);
      assertCurrent();
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
    });

  return {
    wallet,
    demo,
    readiness,
    branch,
    setBranch,
    side,
    setSide,
    tif,
    setTif,
    funding,
    setFunding,
    quantity,
    setQuantity,
    maxFeeBps,
    setMaxFeeBps,
    price,
    setPrice,
    busy,
    preparation,
    setPreparation,
    quoteExpired,
    preview,
    prepare,
    approve,
    submit,
  };
}
