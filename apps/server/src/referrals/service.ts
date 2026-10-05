/** Referral rewards. A referrer earns `shareBps` of the net fees its referees pay for `months`
 * after they join, accrued per fill from finalized trades in the claims those fees were charged
 * in. A market's rewards become real tokens when it resolves (only the winning side's claims pay)
 * and claimable at the first Monday 00:00 UTC after its resolution; a dedicated payout wallet then
 * sends them on request. */
import type { Database, ReferralTotal } from "@conditional-stocks/db";
import type { ChainState, MarketState } from "@conditional-stocks/evm-client/ledger";
import { type IndexerService, publicIdOf } from "@conditional-stocks/indexer";
import { HTTPException } from "hono/http-exception";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  keccak256,
  type PublicClient,
  parseTransaction,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

export const WEEK_SECONDS = 7 * 86_400;
const ACCRUAL_BATCH = 5_000;
const RETRY_MS = 5_000;
const MAX_RETRY_MS = 300_000;
const RECONCILE_MS = 30_000;
/** 1970-01-05 00:00 UTC, a Monday. */
const MONDAY = 4 * 86_400;
/** The first Monday 00:00 UTC strictly after `seconds`. */
export const weeklyUnlock = (seconds: number) =>
  Math.floor((seconds - MONDAY) / WEEK_SECONDS) * WEEK_SECONDS + MONDAY + WEEK_SECONDS;

export interface ReferralConfig {
  shareBps: number;
  months: number;
}
type Status = "pending" | "unlocking" | "claimable" | "lapsed";
interface Amount {
  token: Address;
  amount: bigint;
}
interface MarketRewards {
  market: MarketState;
  /** Claims accrued per branch (0 YES, 1 NO) and collateral (0 quote, 1 base). */
  accrued: { branch: number; collateral: number; token: Address; amount: bigint }[];
  /** Tokens these claims became, once the market resolved (finalized). */
  realized: Amount[] | null;
  unlockAt: number | null;
  status: Status;
}
const add = (into: Map<Address, bigint>, token: Address, amount: bigint) =>
  into.set(token, (into.get(token) ?? 0n) + amount);

export class Referrals {
  private accruing: Promise<void> | undefined;
  /** Trades were stored during a run: it runs again. */
  private again = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryMs = RETRY_MS;
  private unsubscribe: (() => void) | undefined;
  private reconciling: ReturnType<typeof setTimeout> | undefined;
  /** A claim left payouts unsettled since the reconciler last looked. */
  private unsettled = false;
  private stopped = false;

  constructor(
    private readonly options: {
      db: Database;
      indexer: IndexerService;
      client: PublicClient;
      domain: string;
      config: ReferralConfig;
      /** Sends claimed rewards; null leaves claims off. */
      payout: PrivateKeyAccount | null;
      /** A market's YES probability (x1e6) for estimates, or null while unavailable. */
      probability(condition: string): Promise<bigint | null>;
      onError(event: string, error: unknown): void;
      /** How often unsettled payouts are rechecked. */
      reconcileMs?: number;
    },
  ) {}

  /** Accrues what earlier runs stored, then whenever the indexer stores finalized trades, and
   * settles payouts a previous run left in flight. Idle, it makes no calls at all. */
  start() {
    this.unsubscribe = this.options.indexer.onPersistedTrades(() => void this.accrue());
    void this.accrue();
    this.watchPayouts(0);
  }
  stop() {
    this.stopped = true;
    this.unsubscribe?.();
    clearTimeout(this.retry);
    clearTimeout(this.reconciling);
  }

  /** Accrues every stored trade not yet counted; a failure retries with backoff. */
  accrue(): Promise<void> {
    if (this.accruing) {
      this.again = true;
      return this.accruing;
    }
    const { db, domain, config } = this.options;
    this.accruing = (async () => {
      try {
        do {
          this.again = false;
          while (
            (
              await db.accrueReferrals(domain, {
                rateBps: config.shareBps,
                months: config.months,
                limit: ACCRUAL_BATCH,
              })
            ).trades === ACCRUAL_BATCH
          );
        } while (this.again && !this.stopped);
        this.retryMs = RETRY_MS;
      } catch (error) {
        this.options.onError("referrals.accrue.failed", error);
        if (!this.stopped) {
          clearTimeout(this.retry);
          this.retry = setTimeout(() => void this.accrue(), this.retryMs);
          this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
        }
      } finally {
        this.accruing = undefined;
      }
    })();
    return this.accruing;
  }

  /** Runs the reconciler until no payout awaits a receipt. */
  private watchPayouts(delay = this.options.reconcileMs ?? RECONCILE_MS) {
    this.unsettled = true;
    if (!this.options.payout || this.stopped || this.reconciling) return;
    this.reconciling = setTimeout(async () => {
      this.unsettled = false;
      const open = await this.reconcile();
      this.reconciling = undefined;
      if (open > 0 || this.unsettled) this.watchPayouts();
    }, delay);
  }

  /** Unix seconds: the later of the clock and the finalized chain (tests move chain time). */
  private now(s: ChainState) {
    return Math.max(Math.floor(Date.now() / 1000), Number(s.timestamp));
  }

  /** Rewards per market from accrued totals, against the finalized replica. */
  private markets(s: ChainState, totals: ReferralTotal[]): MarketRewards[] {
    const byMarket = new Map<number, ReferralTotal[]>();
    for (const t of totals) byMarket.set(t.market, [...(byMarket.get(t.market) ?? []), t]);
    const now = this.now(s);
    const out: MarketRewards[] = [];
    for (const [id, rows] of byMarket) {
      const market = s.markets.get(id);
      if (!market) continue;
      const token = (collateral: number) => getAddress(collateral === 0 ? s.quote : market.base);
      const accrued = rows.map((r) => ({
        branch: r.branch,
        collateral: r.collateral,
        token: token(r.collateral),
        amount: r.amount,
      }));
      let realized: Amount[] | null = null,
        unlockAt: number | null = null,
        status: Status = "pending";
      if (market.payouts && market.resolvedAt !== null) {
        const [yes, no] = market.payouts;
        const denominator = BigInt(yes + no);
        const collaterals = [...new Set(rows.map((r) => r.collateral))].sort();
        realized = collaterals.map((collateral) => {
          let weighted = 0n;
          for (const r of rows)
            if (r.collateral === collateral)
              weighted += r.amount * BigInt(r.branch === 0 ? yes : no);
          return { token: token(collateral), amount: weighted / denominator };
        });
        unlockAt = weeklyUnlock(Number(market.resolvedAt));
        status = realized.every((r) => r.amount === 0n)
          ? "lapsed"
          : unlockAt <= now
            ? "claimable"
            : "unlocking";
      }
      out.push({ market, accrued, realized, unlockAt, status });
    }
    return out.sort((a, b) => a.market.id - b.market.id);
  }

  /** What a referrer may claim now, per token, net of sent and paid payouts. */
  private claimable(rewards: MarketRewards[], paid: { token: string; amount: bigint }[]) {
    const unlocked = new Map<Address, bigint>();
    for (const r of rewards)
      if (r.status === "claimable")
        for (const a of r.realized ?? []) add(unlocked, a.token, a.amount);
    for (const p of paid) add(unlocked, getAddress(p.token), -p.amount);
    return [...unlocked]
      .filter(([, amount]) => amount > 0n)
      .map(([token, amount]) => ({ token, amount }));
  }

  private tokenView(s: ChainState, token: Address) {
    return {
      token,
      symbol: this.options.indexer.tokens.identity.get(token)?.symbol ?? null,
      decimals: s.pools.get(token)?.decimals ?? null,
    };
  }

  /** The referrer's dashboard. */
  async dashboard(owner: Address) {
    const { db, domain, indexer, config, payout } = this.options;
    const s = indexer.finalized();
    const [totals, refereeTotals, referees, paid, history] = await Promise.all([
      db.referralTotals(domain, owner),
      db.refereeTotals(domain, owner),
      db.referees(owner, config.months),
      db.referralPaidTotals(domain, owner),
      db.referralPayouts(domain, owner),
    ]);
    const rewards = this.markets(s, totals);
    const now = this.now(s);
    const unlocking = new Map<string, { token: Address; amount: bigint; unlockAt: number }>();
    for (const { status, realized, unlockAt } of rewards)
      if (status === "unlocking" && unlockAt !== null)
        for (const a of realized ?? [])
          if (a.amount > 0n) {
            const key = `${unlockAt}:${a.token}`;
            const prior = unlocking.get(key);
            unlocking.set(key, {
              token: a.token,
              unlockAt,
              amount: (prior?.amount ?? 0n) + a.amount,
            });
          }
    const probabilities = new Map(
      await Promise.all(
        rewards
          .filter((r) => r.status === "pending")
          .map(
            async (r) =>
              [
                r.market.id,
                await this.options.probability(r.market.condition).catch(() => null),
              ] as const,
          ),
      ),
    );
    const fills = new Map<string, number>();
    for (const t of refereeTotals) fills.set(t.referee, (fills.get(t.referee) ?? 0) + t.fills);
    const amount = (a: { token: Address; amount: bigint }) => ({
      ...this.tokenView(s, a.token),
      amount: a.amount.toString(),
    });
    const nextUnlock = [...unlocking.values()].reduce<number | null>(
      (min, u) => (min === null || u.unlockAt < min ? u.unlockAt : min),
      null,
    );
    return {
      program: { shareBps: config.shareBps, months: config.months },
      now,
      claimsEnabled: payout !== null,
      nextUnlockAt: nextUnlock,
      referees: referees.map((m) => ({
        wallet: getAddress(m.wallet),
        joinedAt: m.joinedAt.toISOString(),
        earningUntil: m.earningUntil.toISOString(),
        fills: fills.get(m.wallet) ?? 0,
      })),
      markets: rewards.map((r) => ({
        marketId: publicIdOf(s, r.market.id),
        venueId: String(r.market.id),
        state: r.market.state,
        cutoff: r.market.cutoff.toString(),
        resolvedAt: r.market.resolvedAt?.toString() ?? null,
        unlockAt: r.unlockAt,
        status: r.status,
        probabilityYesX6: probabilities.get(r.market.id)?.toString() ?? null,
        accrued: r.accrued.map((a) => ({
          branch: a.branch,
          collateral: a.collateral,
          ...amount(a),
        })),
        realized: r.realized?.filter((a) => a.amount > 0n).map(amount) ?? null,
      })),
      totals: {
        claimable: this.claimable(rewards, paid).map(amount),
        unlocking: [...unlocking.values()]
          .sort((a, b) => a.unlockAt - b.unlockAt)
          .map((u) => ({ ...amount(u), unlockAt: u.unlockAt })),
        paid: paid.map((p) => amount({ token: getAddress(p.token), amount: p.amount })),
      },
      payouts: history.map((p) => ({
        id: p.id,
        ...amount({ token: getAddress(p.token), amount: p.amount }),
        status: (["sent", "paid", "failed"] as const)[p.status],
        transactionHash: p.tx,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  /** Sends everything claimable now, one transfer per token. Claims are serialized, and each
   * transfer is signed and journaled (committed) before it is broadcast: a crash can leave a
   * transfer unconfirmed, never paid twice. */
  async claim(owner: Address) {
    const { db, domain, indexer, client, payout } = this.options;
    if (!payout) throw new HTTPException(503, { message: "Referral payouts are not enabled yet." });
    const { sent, unavailable } = await db.serialized(`referral-payouts:${domain}`, async (q) => {
      const s = indexer.finalized();
      const due = this.claimable(
        this.markets(s, await q.referralTotals(domain, owner)),
        await q.referralPaidTotals(domain, owner),
      );
      if (!due.length) throw new HTTPException(400, { message: "Nothing is claimable yet." });
      let [gas, nonce] = await Promise.all([
        client.getBalance({ address: payout.address }),
        client.getTransactionCount({ address: payout.address, blockTag: "pending" }),
      ]);
      const sent: { id: string; token: Address; amount: bigint; hash: Hex }[] = [];
      const unavailable: Amount[] = [];
      for (const [i, d] of due.entries()) {
        const balance = await client.readContract({
          address: d.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [payout.address],
        });
        // Underfunded, or a transfer that would fail: it stays claimable.
        const request =
          balance < d.amount
            ? null
            : await client
                .prepareTransactionRequest({
                  account: payout,
                  chain: client.chain,
                  nonce,
                  to: d.token,
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "transfer",
                    args: [owner, d.amount],
                  }),
                })
                .catch(() => null);
        if (!request) {
          unavailable.push(d);
          continue;
        }
        const cost = request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
        if (cost > gas) {
          unavailable.push(...due.slice(i));
          break;
        }
        const raw = await payout.signTransaction(request as never);
        const hash = keccak256(raw);
        const id = await q.recordReferralPayout(domain, {
          referrer: owner,
          token: d.token,
          amount: d.amount,
          tx: hash,
          raw,
        });
        nonce++;
        gas -= cost;
        sent.push({ id, token: d.token, amount: d.amount, hash });
        // An ambiguous send is resolved by its receipt or the reconciler; later transfers would
        // only queue behind it.
        if (
          !(await client.sendRawTransaction({ serializedTransaction: raw }).then(
            () => true,
            () => false,
          ))
        )
          break;
      }
      if (!sent.length)
        throw new HTTPException(503, {
          message: "Payouts are paused while the payout wallet is refilled. Try again later.",
        });
      return { sent, unavailable };
    });
    const payouts = await Promise.all(
      sent.map(async (p) => {
        const receipt = await client
          .waitForTransactionReceipt({ hash: p.hash, timeout: 60_000 })
          .catch(() => null);
        if (receipt) await db.settleReferralPayout(p.id, receipt.status === "success" ? 1 : 2);
        return {
          token: p.token,
          amount: p.amount.toString(),
          transactionHash: p.hash,
          status: !receipt ? "sent" : receipt.status === "success" ? "paid" : "failed",
        };
      }),
    );
    if (payouts.some((p) => p.status === "sent")) this.watchPayouts();
    const s = indexer.finalized();
    return {
      payouts,
      unavailable: unavailable.map((u) => ({
        ...this.tokenView(s, u.token),
        amount: u.amount.toString(),
      })),
    };
  }

  /** Settles payouts whose receipts arrived; resends unmined ones; fails those whose nonce
   * another transaction took (their amounts become claimable again). Returns how many still
   * await a receipt. */
  async reconcile(): Promise<number> {
    const { db, domain, client, payout } = this.options;
    if (!payout) return 0;
    try {
      let open = 0,
        used: number | undefined;
      for (const p of await db.sentReferralPayouts(domain)) {
        const hash = p.tx as Hex;
        const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
        if (receipt) {
          await db.settleReferralPayout(p.id, receipt.status === "success" ? 1 : 2);
          continue;
        }
        used ??= await client.getTransactionCount({ address: payout.address, blockTag: "latest" });
        const nonce = parseTransaction(p.raw as Hex).nonce ?? 0;
        if (used > nonce) {
          // Taken by another transaction, unless this one landed since the first look.
          const late = await client.getTransactionReceipt({ hash }).catch(() => null);
          await db.settleReferralPayout(p.id, late?.status === "success" ? 1 : 2);
          continue;
        }
        open++;
        await client.sendRawTransaction({ serializedTransaction: p.raw as Hex }).catch(() => {});
      }
      return open;
    } catch (error) {
      this.options.onError("referrals.reconcile.failed", error);
      return 1;
    }
  }

  /** The program's obligations per token against the payout wallet's balances. */
  async overview() {
    const { db, domain, indexer, client, payout, config } = this.options;
    const s = indexer.finalized();
    const [totals, paid] = await Promise.all([
      db.referralProgramTotals(domain),
      db.referralPaidTotals(domain),
    ]);
    const rewards = this.markets(s, totals);
    const tokens = new Map<
      Address,
      { pending: bigint; unlocking: bigint; unlocked: bigint; paid: bigint }
    >();
    const entry = (token: Address) => {
      const e = tokens.get(token) ?? { pending: 0n, unlocking: 0n, unlocked: 0n, paid: 0n };
      tokens.set(token, e);
      return e;
    };
    for (const r of rewards) {
      if (r.status === "pending") for (const a of r.accrued) entry(a.token).pending += a.amount;
      for (const a of r.realized ?? [])
        if (r.status === "unlocking") entry(a.token).unlocking += a.amount;
        else if (r.status === "claimable") entry(a.token).unlocked += a.amount;
    }
    for (const p of paid) entry(getAddress(p.token)).paid += p.amount;
    const balances = payout
      ? await Promise.all(
          [...tokens.keys()].map(
            async (token) =>
              [
                token,
                await client.readContract({
                  address: token,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [payout.address],
                }),
              ] as const,
          ),
        )
      : [];
    const balance = new Map(balances);
    return {
      program: { shareBps: config.shareBps, months: config.months },
      payoutWallet: payout?.address ?? null,
      gas: payout ? (await client.getBalance({ address: payout.address })).toString() : null,
      markets: rewards.length,
      tokens: [...tokens].map(([token, e]) => {
        const owed = e.unlocking + e.unlocked - e.paid;
        const held = balance.get(token) ?? 0n;
        return {
          ...this.tokenView(s, token),
          pendingClaims: e.pending.toString(),
          unlocking: e.unlocking.toString(),
          unlocked: e.unlocked.toString(),
          paid: e.paid.toString(),
          owed: owed.toString(),
          balance: payout ? held.toString() : null,
          shortfall: (owed > held ? owed - held : 0n).toString(),
        };
      }),
    };
  }
}
