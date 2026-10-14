"use client";
import {
  type AtomicPlan,
  formatBps,
  type OrderWire,
  orderFeeCap,
  parseAtomicPlan,
  parseOrder,
  quote,
} from "@conditional-stocks/evm-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { toast } from "@/components/ui/toast";
import { venueDeployment } from "@/config/protocol";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { usePositions } from "@/hooks/useProtocolData";
import {
  announceTradingPermissionChange,
  useTradingPermission,
} from "@/hooks/useTradingPermission";
import { useTradingReadiness } from "@/hooks/useTradingReadiness";
import { baseHalt, claimBalance } from "@/lib/markets/base";
import { marketPriceBound } from "@/lib/trading/entry";
import { createOrder, previewOrder } from "@/lib/trading/order";
import { tradingPermissionApproval } from "@/lib/trading/permission";
import { reviewWithSession } from "@/lib/trading/review-session";
import { api } from "@/services/protocol-api-service";
import { refreshStores } from "@/stores/createResourceStore";
import type { MarketView } from "@/types/api";

interface Preparation {
  funding: {
    balanceSufficient: boolean;
    /** Raw units of the funding asset (quote for buys, the base token for sells). */
    amount: string;
    decimals: number;
    symbol: string;
  };
  order: OrderWire;
  notional: string;
  plan: AtomicPlan;
  exchange: string;
  /** Approved RFQ makers online for a market order: they quote it at submission, and the order
   * fills from their quotes and the book together, best price first. */
  rfq?: { makers: number };
  /** Idempotency key of the delegated submission: retries never place a second order. */
  clientId: string;
}
export function useOrderTicket({ market }: { market: MarketView }) {
  const wallet = useWallet(),
    readiness = useTradingReadiness(market),
    positions = usePositions(),
    {
      permission,
      loaded: permissionLoaded,
      error: permissionError,
      refresh: refreshPermission,
    } = useTradingPermission();
  const [branch, setBranch] = useState<"YES" | "NO">("YES"),
    [side, setSide] = useState<"buy" | "sell">("buy"),
    [tif, setTif] = useState<"gtc" | "ioc">("ioc"),
    [funding, setFunding] = useState<"whole" | "claim">("whole");
  const branchIndex = branch === "YES" ? 0 : 1;
  const position =
    positions.data?.owner === wallet.account
      ? positions.data?.positions.find((p) => p.venue.marketId === market.venue.marketId)
      : undefined;
  /** Funding balance in raw units: vault credit ("whole") or this branch's claims. */
  const fundingBalance = (orderSide: "buy" | "sell") => {
    if (positions.data?.owner !== wallet.account) return null;
    if (funding === "claim")
      return claimBalance(position, orderSide === "buy" ? 0 : 1, branchIndex);
    const token = orderSide === "buy" ? market.quoteToken : market.base.token;
    const balance = positions.data?.balances[token];
    return balance ? BigInt(balance.vaultAvailable) : null;
  };
  const available = fundingBalance(side);
  const quoteSymbol = market.quoteTokenMetadata?.symbol ?? "USDC";
  const legError = baseHalt(market);
  const initialMarketPrice = () => {
    try {
      return marketPriceBound(market, "YES", "buy", 100);
    } catch {
      return "";
    }
  };
  const [quantity, setQuantity] = useState(""),
    [price, setPrice] = useState(initialMarketPrice);
  // The market's fees are fixed: an order consents to exactly the rates that can apply to it.
  const maxFeeBps = orderFeeCap(market.fees, tif === "ioc" ? 1 : 0);
  // Only user-controlled/signed inputs belong to the action identity. Indexed
  // position blocks advance in the background while a submission is in flight;
  // treating those updates as an action change used to cancel valid orders.
  const actionContext = [
    wallet.account,
    market.id,
    branch,
    side,
    tif,
    funding,
    quantity,
    price,
    maxFeeBps,
    permission?.active,
    permission?.delegate,
    permission?.grant?.expiresAt,
  ].join(":");
  // Balance snapshots still invalidate an idle review so funding sufficiency is
  // recalculated, but they must not invalidate an already-started submission.
  const reviewContext = [actionContext, positions.data?.blockNumber].join(":");
  const revision = useRef({ context: reviewContext, version: 0 });
  if (revision.current.context !== reviewContext)
    revision.current = { context: reviewContext, version: revision.current.version + 1 };
  const [review, setReview] = useState<{
    actionContext: string;
    reviewContext: string;
    value: Preparation;
  } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNonce, setReviewNonce] = useState(0);
  const [completedContext, setCompletedContext] = useState<string | null>(null);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const { busy, run } = useAsyncAction(actionContext);
  const preparation =
    review?.actionContext === actionContext && (busy || review.reviewContext === reviewContext)
      ? review.value
      : null;
  const setPreparation = (value: Preparation | null) =>
    setReview(value ? { actionContext, reviewContext, value } : null);
  const { busy: permissionBusy, run: runPermissionAction } = useAsyncAction(
    [wallet.account, permission?.delegate].join(":"),
  );
  useEffect(() => {
    if (!preparation) return;
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [preparation]);
  const quoteExpired = preparation
    ? BigInt(preparation.plan.deadline) <= BigInt(nowSeconds)
    : false;
  const preview = useMemo(() => previewOrder(quantity, price, market), [quantity, price, market]);
  const prepareAction = async (assertCurrent: () => void, background = false) => {
    if (
      !wallet.account ||
      !preview.valid ||
      !permission?.active ||
      !permission.delegate ||
      !permission.grant
    )
      throw new Error("Deposit assets and enable trading in Portfolio before placing an order.");
    if (legError) throw new Error(legError);
    if (permission.grant.maxFeeBps < maxFeeBps)
      throw new Error(
        `This market's ${formatBps(maxFeeBps)} fee is above your trading permission's ${formatBps(permission.grant.maxFeeBps)} fee cap. Revoke the trading permission in Portfolio and approve it again to raise the cap.`,
      );
    assertCurrent();
    const candidate = parseOrder(
      createOrder({
        ...market,
        account: wallet.account,
        delegate: permission.delegate,
        delegateExpiresAt: permission.grant.expiresAt,
        branch,
        cutoff: market.cutoff,
        funding,
        // Orders name the on-chain market of the venue they trade on.
        marketId: market.venue.marketId,
        maxFeeBps,
        price,
        quantity,
        side,
        tif,
      }),
    );
    const result = background
      ? await api.prepare<Omit<Preparation, "funding" | "clientId">>(
          "orders/prepare",
          { order: candidate },
          wallet.sessionId ?? true,
        )
      : await reviewWithSession({
          session: wallet.sessionId,
          request: (auth) =>
            api.prepare<Omit<Preparation, "funding" | "clientId">>(
              "orders/prepare",
              { order: candidate },
              auth,
            ),
          authenticate: () => wallet.authenticate(),
          assertCurrent,
        });
    // Funding: quote for buys, the base token for sells; vault credit or active claims.
    const required =
      candidate.side === 0
        ? quote(BigInt(candidate.quantity), BigInt(candidate.limitPriceRawX18), true)
        : BigInt(candidate.quantity);
    const balance = fundingBalance(candidate.side === 0 ? "buy" : "sell") ?? 0n;
    parseAtomicPlan(result.plan, candidate);
    assertCurrent();
    if (result.exchange.toLowerCase() !== venueDeployment(market.venue).exchange.toLowerCase())
      throw new Error("API order identity differs.");
    if (BigInt(result.plan.deadline) <= BigInt(Math.floor(Date.now() / 1000)))
      throw new Error("The returned quote has already expired. Retry review.");
    const next: Preparation = {
      notional: result.notional,
      plan: result.plan,
      exchange: result.exchange,
      ...(result.rfq ? { rfq: result.rfq } : {}),
      clientId: crypto.randomUUID(),
      funding: {
        balanceSufficient: positions.isDataFresh && balance >= required,
        amount: String(required),
        decimals: candidate.side === 0 ? market.quoteTokenDecimals : market.base.decimals,
        symbol: candidate.side === 0 ? quoteSymbol : market.ticker,
      },
      order: candidate,
    };
    setNowSeconds(Math.floor(Date.now() / 1000));
    setPreparation(next);
    return next;
  };
  const latestPrepare = useRef(prepareAction);
  latestPrepare.current = prepareAction;
  const canReview = Boolean(
    wallet.account &&
      preview.valid &&
      !legError &&
      readiness.ready &&
      positions.isDataFresh &&
      Boolean(permission?.active) &&
      market.lifecycle === "open" &&
      completedContext !== actionContext,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Signed input identity and explicit refresh restart the debounce; streamed market objects do not.
  useEffect(() => {
    let active = true;
    const version = revision.current.version;
    // Freeze the reviewed order once submission begins. Background SSE/indexer
    // updates may refresh balances, but the API and program remain authoritative
    // for the submitted order and will reject insufficient funds atomically.
    if (busy) return;
    setReview(null);
    setReviewError(null);
    setReviewing(canReview);
    if (!canReview) return;
    const assertCurrent = () => {
      if (!active || revision.current.version !== version) throw new Error("Order inputs changed.");
    };
    const timer = setTimeout(async () => {
      try {
        assertCurrent();
        await latestPrepare.current(assertCurrent, true);
      } catch (error) {
        if (active && revision.current.version === version)
          setReviewError(error instanceof Error ? error.message : "Order review failed.");
      } finally {
        if (active && revision.current.version === version) setReviewing(false);
      }
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [reviewContext, canReview, reviewNonce, busy]);
  useEffect(() => {
    if (!preparation || busy) return;
    const remaining = Number(preparation.plan.deadline) * 1000 - Date.now();
    // Refresh at most every 30s, earlier for short-lived quotes. Never replace
    // the reviewed plan while a funding/signing action is in progress.
    const delay = Math.max(
      500,
      Math.min(30_000, remaining > 10_000 ? remaining - 5_000 : remaining / 2),
    );
    const refresh = () => {
      if (document.visibilityState !== "hidden") setReviewNonce((value) => value + 1);
    };
    const resume = () => {
      if (document.visibilityState !== "hidden" && Date.now() >= refreshAt) refresh();
    };
    const refreshAt = Date.now() + delay;
    const timer = setTimeout(refresh, delay);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [preparation, busy]);
  const prepare = () =>
    run(async (assertCurrent) => {
      const version = revision.current.version;
      const assertReviewCurrent = () => {
        assertCurrent();
        if (revision.current.version !== version)
          throw new Error("Order inputs or balances changed. Review the action again.");
      };
      setReviewError(null);
      setPreparation(null);
      await prepareAction(assertReviewCurrent);
    });
  const submitPreparation = async (current: Preparation, assertCurrent: () => void) => {
    if (!wallet.account || !readiness.ready || !permission?.active)
      throw new Error("Review a currently tradable order first.");
    await readiness.requireReady();
    assertCurrent();
    if (
      current.order.maker !== wallet.account ||
      BigInt(current.plan.deadline) <= BigInt(Math.floor(Date.now() / 1000))
    )
      throw new Error("Wallet changed or quote expired.");
    if (!current.funding.balanceSufficient)
      throw new Error("Deposit the required balance in Portfolio");
    const session = wallet.sessionId ?? (await wallet.authenticate());
    assertCurrent();
    const response = await api.prepare<{ transactionHash: string; orderHash: string | null }>(
      "trading/submit",
      { order: current.order, clientId: current.clientId },
      session,
    );
    if (!/^0x[0-9a-f]{64}$/i.test(response.transactionHash ?? ""))
      throw new Error("Submitted order identity differs from the reviewed order");
    assertCurrent();
    toast.add({
      type: "success",
      title: `Order confirmed: ${response.transactionHash.slice(0, 10)}… Vault balances update after indexing.`,
    });
    setCompletedContext(actionContext);
    setPreparation(null);
    setQuantity("");
    setTif("ioc");
    try {
      setPrice(marketPriceBound(market, branch, side, 100));
    } catch {
      setPrice("");
    }
    setSubmissionCount((value) => value + 1);
    void refreshStores(["positions", "wallet-orders", "wallet-trades", "payout-credits"]);
    void refreshPermission();
  };
  const submit = () =>
    run(async (assertCurrent) => {
      if (!preparation) throw new Error("Review a currently tradable order first.");
      await submitPreparation(preparation, assertCurrent);
    });
  const enableTrading = () =>
    runPermissionAction(async (assertCurrent) => {
      if (!wallet.account) throw new Error("Connect a wallet to enable trading");
      const current = await refreshPermission();
      assertCurrent();
      if (!current) throw new Error(permissionError ?? "Trading permission is unavailable");
      await wallet.ensureNetwork();
      assertCurrent();
      const transaction = tradingPermissionApproval({ owner: wallet.account, permission: current });
      const hash = await wallet.sendTransaction(transaction);
      toast.add({ type: "success", title: `Trading permission confirmed · ${hash.slice(0, 10)}…` });
      for (let attempt = 0; attempt < 20; attempt++) {
        assertCurrent();
        const refreshed = await refreshPermission();
        if (refreshed?.active) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      announceTradingPermissionChange();
    });
  return {
    wallet,
    permission,
    permissionLoaded,
    permissionError,
    readiness,
    branch,
    setBranch,
    side,
    setSide,
    tif,
    setTif,
    funding,
    setFunding,
    available,
    quoteSymbol,
    legError,
    quantity,
    setQuantity,
    maxFeeBps,
    price,
    setPrice,
    busy: busy || permissionBusy,
    reviewing,
    reviewError,
    submissionCount,
    preparation,
    setPreparation,
    quoteExpired,
    preview,
    prepare,
    enableTrading,
    submit,
  };
}
