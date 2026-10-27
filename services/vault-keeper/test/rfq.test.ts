/** The vault on the RFQ stream, against a real exchange and Δ-vault on anvil: the keeper answers a
 * request from memory with a quote the keeper wallet signs, the API's own request and settlement
 * code carries it into the taker's transaction, and the exchange fills it from the vault's
 * holdings after the vault accepted it on chain. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as tx from "@conditional-stocks/evm-client";
import { ChainFollower, TokenReader } from "@conditional-stocks/indexer";
import { Executor, type Reference } from "@conditional-stocks/operator";
import {
  decodeEventLog,
  encodeFunctionData,
  keccak256,
  parseAbi,
  stringToBytes,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quoteDigest, quoteFill } from "../../../apps/server/src/rfq/auction.ts";
import { type MakerQuote, rfqRequest } from "../../../apps/server/src/rfq/protocol.ts";
import {
  type Anvil,
  accounts,
  deployDeltaVault,
  deployProtocol,
  openMarket,
  send,
  startAnvil,
  tokenAbi,
} from "../../../packages/evm-client/test/anvil.ts";
import { settings } from "../src/config.ts";
import { Keeper, vaultOrders } from "../src/engine.ts";
import type { LiveReferences } from "../src/live.ts";
import { RfqMaker, type RfqSocket } from "../src/rfq.ts";
import { initialState } from "../src/state.ts";
import { Tick } from "../src/tick.ts";

const NOW = BigInt(Math.floor(Date.now() / 1000));
const NVDA = 10n ** 18n;
const USDC = 10n ** 6n;
const keeperAccount = privateKeyToAccount(toHex(accounts[3]!.getHdKey().privateKey!));
const taker = accounts[1]!.address;
let node: Anvil;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
let vault: `0x${string}`;
let follower: ChainFollower;
let keeper: Keeper;
let reference: Reference;
const live = {
  reference: () => {
    if (Date.now() - reference.observedAt > 5_000) throw new Error("Live reference unavailable");
    return reference;
  },
  track: () => {},
} as unknown as LiveReferences;
const fresh = (spot = 100n * USDC, probability = 400_000n) => {
  const now = Date.now();
  reference = {
    spot,
    probability,
    spread: 10_000n,
    observedAt: now,
    spotAt: now,
    probabilityAt: now,
  };
};

/** A connected maker over a scripted socket: what it sent, and a way to deliver frames. */
function connect() {
  const sent: Record<string, any>[] = [];
  const socket: RfqSocket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: (data) => sent.push(JSON.parse(data)),
    close: () => {},
  };
  const maker = new RfqMaker({
    keeper,
    url: "ws://api.test/v1/rfq/stream",
    apiKey: "pbl_rfq_test",
    account: keeperAccount,
    connect: () => socket,
  });
  maker.start();
  const deliver = (message: object) => socket.onmessage!({ data: JSON.stringify(message) });
  deliver({
    type: "welcome",
    version: 1,
    maker: { id: "m", label: "vault", wallet: vault },
    chainId: 31337,
    exchange: protocol.exchange,
    minQuoteSeconds: 3,
  });
  return { maker, sent, deliver };
}
/** The API's request for a market order of the taker (YES branch). */
function request(id: string, side: 0 | 1, quantity: bigint, limit: bigint, market = 1) {
  const s = follower.confirmed;
  const m = s.markets.get(1)!;
  return rfqRequest({
    id,
    sentAt: Date.now(),
    windowMs: 500,
    minQuoteSeconds: 3,
    chainId: 31337,
    exchange: protocol.exchange,
    market: { ...m, id: market },
    quoteToken: protocol.usdc,
    quoteDecimals: 6,
    baseDecimals: 18,
    order: takerOrder(side, quantity, limit),
    book: { bestBid: null, bestAsk: null },
  });
}
const takerOrder = (side: 0 | 1, quantity: bigint, limit: bigint): tx.OrderWire => ({
  maker: taker,
  marketId: "1",
  quantity: quantity.toString(),
  limitPriceRawX18: limit.toString(),
  expiry: (NOW + 3600n).toString(),
  maxFeeBps: 100,
  branch: 0,
  side,
  fundingKind: 0,
  tif: 1,
});
const reply = async (sent: Record<string, any>[], id: string) => {
  for (let i = 0; i < 200; i++) {
    const found = sent.find((m) => m.rfqId === id);
    if (found) return found;
    await Bun.sleep(1);
  }
  throw new Error("No reply");
};
/** Fills a quote the way the API does: the taker's own placement carries it. */
async function fillQuote(order: tx.OrderWire, q: Record<string, any>) {
  const m = follower.confirmed.markets.get(1)!;
  const terms: MakerQuote = {
    price: BigInt(q.price),
    quantity: BigInt(q.quantity),
    fundingKind: q.fundingKind,
    expiry: BigInt(q.expiry),
    nonce: BigInt(q.nonce),
    signature: q.signature,
  };
  const fill = quoteFill(m, order, terms, BigInt(order.quantity));
  const now = (await node.publicClient.getBlock()).timestamp;
  const plan = {
    nextSequence: m.seq[0].toString(),
    deadline: (now + 60n).toString(),
    minFill: "0",
    makers: [],
    sequences: [],
    quantities: [],
    expectedRemaining: [],
    filledQuantity: order.quantity,
    remainingQuantity: "0",
    executionQuote: "0",
    makerFeeBps: 20,
    takerFeeBps: 50,
    quotes: [fill],
  };
  const receipt = await send(
    node,
    1,
    tx.placement(protocol.exchange, order, plan as never, m.tick),
  );
  const fills = receipt.logs.flatMap((log) => {
    try {
      const e = decodeEventLog({
        abi: tx.conditionalStocksAbi,
        data: log.data,
        topics: log.topics,
      });
      return e.eventName === "QuoteFilled" ? [e.args as { maker: string; fill: bigint }] : [];
    } catch {
      return [];
    }
  });
  return { fills, digest: quoteDigest(31337, protocol.exchange, m, order, terms) };
}
const synced = async () => {
  const block = await node.publicClient.getBlockNumber({ cacheTime: 0 });
  while (follower.confirmed.block < block) await Bun.sleep(25);
};

beforeAll(async () => {
  node = await startAnvil(Number(NOW));
  protocol = await deployProtocol(node);
  await openMarket(node, protocol, NOW, { makerBps: 20, takerBps: 50 });
  ({ vault } = await deployDeltaVault(node, protocol, NOW));
  const admin = accounts[0]!.address;
  await send(node, 0, tx.deltaVaultGrantRole(vault, "curator", admin));
  await send(node, 0, tx.deltaVaultGrantRole(vault, "guardian", admin));
  await send(node, 0, tx.deltaVaultGrantRole(vault, "keeper", keeperAccount.address));
  await send(node, 0, tx.deltaVaultSetCaps(vault, 10n ** 13n, 10n ** 24n));
  await send(
    node,
    0,
    tx.deltaVaultSetLimits(vault, { maxTtl: 600, maxOracleAge: 86_400, maxFeeBps: 100 }),
  );
  await send(
    node,
    0,
    tx.deltaVaultAddMarket(vault, 1, {
      bandBps: 1000,
      cutoffBuffer: 3600,
      maxOrder: 50_000n * USDC,
      maxResting: 200_000n * USDC,
      maxImbalance: 200n * NVDA,
    }),
  );
  for (const [to, quote, base] of [
    [admin, 100_000n * USDC, 1000n * NVDA],
    [taker, 1_000_000n * USDC, 10_000n * NVDA],
  ] as const)
    for (const [token, amount] of [
      [protocol.usdc, quote],
      [protocol.stock, base],
    ] as const)
      await send(node, 0, {
        to: token,
        data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [to, amount] }),
      });
  await send(node, 0, tx.approve(protocol.usdc, vault, 100_000n * USDC));
  await send(node, 0, tx.approve(protocol.stock, vault, 1000n * NVDA));
  await send(node, 0, tx.deltaVaultDeposit(vault, 100_000n * USDC, 1000n * NVDA, 0n, admin));
  for (const [token, amount] of [
    [protocol.usdc, 1_000_000n * USDC],
    [protocol.stock, 10_000n * NVDA],
  ] as const) {
    await send(node, 1, tx.approve(token, protocol.exchange, amount));
    await send(node, 1, tx.deposit(protocol.exchange, token, amount));
  }
  follower = new ChainFollower({
    client: node.publicClient,
    exchange: protocol.exchange,
    quote: protocol.usdc,
    deploymentBlock: 1n,
    domain: "test",
    pollMs: 100,
  });
  await follower.start();
  const tokens = new TokenReader(node.publicClient);
  const config = settings({
    vault,
    markets: [{ market: 1, anchorBps: 300, impactBps: 50, maxGapBps: 800, orderQuote: "20000" }],
    pollMs: 1000,
    rfq: { enabled: true },
  });
  fresh();
  const journal = initialState(`test:${vault}`);
  keeper = new Keeper(
    follower,
    tokens,
    node.publicClient,
    31337,
    config,
    config.vaults[0]!,
    { address: vault, exchange: protocol.exchange, quote: protocol.usdc, base: protocol.stock },
    journal,
    () => {},
    new Executor(node.publicClient, keeperAccount, config, journal, () => {}, {
      receiptPollMs: 50,
      gasHeadroomBps: 2500,
    }),
    async () => reference,
  );
  keeper.live = live;
  // One round: the vault view RFQ quotes price against, and (RFQ only) nothing on the book.
  await keeper.cycle(
    new Tick({
      origin: "http://127.0.0.1",
      client: node.publicClient,
      tokens,
      quote: protocol.usdc,
      bases: [protocol.stock],
      spotPrices: async () => ({ prices: [] }) as never,
      event: async () => ({}),
    }),
  );
}, 120_000);

afterAll(() => {
  follower?.stop();
  node?.stop();
});

describe("RFQ quoting", () => {
  test("quoting only through RFQ, the vault rests nothing on the book", async () => {
    await synced();
    expect(vaultOrders(follower.confirmed, vault)).toHaveLength(0);
  });

  test("a market buy is answered within milliseconds with a keeper-signed quote the exchange fills from the vault", async () => {
    const { sent, deliver } = connect();
    fresh();
    const order = takerOrder(0, 2n * NVDA, 110n * USDC);
    const started = performance.now();
    deliver(request("10000000-0000-4000-8000-000000000001", 0, 2n * NVDA, 110n * USDC));
    const q = await reply(sent, "10000000-0000-4000-8000-000000000001");
    expect(performance.now() - started).toBeLessThan(100);
    expect(q.type).toBe("quote");
    // δ₀ 3%, p 0.4: fair YES $101.80 plus a little impact; at least the 40 bps floor over it,
    // inside the order's $110 limit.
    const price = BigInt(q.price);
    expect(price).toBeGreaterThan((10_180n * USDC * 10_040n) / 1_000_000n);
    expect(price).toBeLessThan(103n * USDC);
    expect(BigInt(q.quantity)).toBe(2n * NVDA);
    // The nonce names the vault: the exchange asks it, not a wallet recovery.
    expect(tx.quoteNonceMaker(BigInt(q.nonce))).toBe(vault);

    const vaultYes = await accountOf(0);
    const { fills, digest } = await fillQuote(order, q);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.maker).toBe(vault);
    expect(fills[0]!.fill & tx.U96_MAX).toBe(2n * NVDA);
    // The vault sold two YES shares for their quote claims (less its 20 bps maker fee).
    const after = await accountOf(0);
    expect(after.quote - vaultYes.quote).toBe(
      tx.quote(2n * NVDA, price) - (tx.quote(2n * NVDA, price) * 20n) / 10_000n,
    );
    // The API's signer check (ERC-1271) vouches for the keeper.
    expect(
      await node.publicClient.readContract({
        address: vault,
        abi: parseAbi(["function isValidSignature(bytes32, bytes) view returns (bytes4)"]),
        functionName: "isValidSignature",
        args: [digest, q.signature],
      }),
    ).toBe("0x1626ba7e");
    keeper.quoteOutcome("10000000-0000-4000-8000-000000000001", "filled");
  });

  test("outstanding quotes and the fills so far make the next buy pay more", async () => {
    await synced();
    const { sent, deliver } = connect();
    fresh();
    deliver(request("10000000-0000-4000-8000-000000000002", 0, 2n * NVDA, 110n * USDC));
    const first = BigInt((await reply(sent, "10000000-0000-4000-8000-000000000002")).price);
    deliver(request("10000000-0000-4000-8000-000000000003", 0, 2n * NVDA, 110n * USDC));
    const second = BigInt((await reply(sent, "10000000-0000-4000-8000-000000000003")).price);
    expect(second).toBeGreaterThan(first);
    // Lost quotes free their capacity at once.
    keeper.quoteOutcome("10000000-0000-4000-8000-000000000002", "lost");
    keeper.quoteOutcome("10000000-0000-4000-8000-000000000003", "lost");
    deliver(request("10000000-0000-4000-8000-000000000004", 0, 2n * NVDA, 110n * USDC));
    expect(BigInt((await reply(sent, "10000000-0000-4000-8000-000000000004")).price)).toBe(first);
  });

  test("the vault posts its prices for a $100 order on both branches: what an RFQ for it is quoted", async () => {
    const { maker, sent, deliver } = connect();
    fresh();
    // Synchronous and from memory, like the quotes: posting costs no chain or API call.
    maker.indicate();
    const posted = sent.filter((m) => m.type === "indications").at(-1) ?? { prices: [] };
    expect(
      posted.prices.map((p: { market: number; branch: number }) => [p.market, p.branch]),
    ).toEqual([
      [1, 0],
      [1, 1],
    ]);
    const yes = posted.prices[0];
    expect(BigInt(yes.bid)).toBeLessThan(BigInt(yes.ask));
    // $100 at the vault's $100 oracle price: one NVDA, bought at the posted ask.
    deliver(request("50000000-0000-4000-8000-000000000001", 0, NVDA, 110n * USDC));
    const q = await reply(sent, "50000000-0000-4000-8000-000000000001");
    expect(q.price).toBe(yes.ask);
    keeper.quoteOutcome("50000000-0000-4000-8000-000000000001", "lost");
    maker.stop();
  });

  test("a sell is bid for below fair, and a sell at a limit above the bid is declined", async () => {
    const { sent, deliver } = connect();
    fresh();
    deliver(request("20000000-0000-4000-8000-000000000001", 1, NVDA, 90n * USDC));
    const bid = await reply(sent, "20000000-0000-4000-8000-000000000001");
    expect(bid.type).toBe("quote");
    expect(BigInt(bid.price)).toBeLessThan(10_180n * 10_000n);
    deliver(request("20000000-0000-4000-8000-000000000002", 1, NVDA, 102n * USDC));
    expect((await reply(sent, "20000000-0000-4000-8000-000000000002")).type).toBe("decline");
  });

  test("other vaults' markets, stale references and a set drawdown latch are declined at once", async () => {
    const { sent, deliver } = connect();
    fresh();
    deliver(request("30000000-0000-4000-8000-000000000001", 0, NVDA, 110n * USDC, 7));
    expect((await reply(sent, "30000000-0000-4000-8000-000000000001")).type).toBe("decline");
    reference = { ...reference, observedAt: Date.now() - 6_000 };
    deliver(request("30000000-0000-4000-8000-000000000002", 0, NVDA, 110n * USDC));
    expect((await reply(sent, "30000000-0000-4000-8000-000000000002")).type).toBe("decline");
    fresh();
    keeper.state.halted = true;
    deliver(request("30000000-0000-4000-8000-000000000003", 0, NVDA, 110n * USDC));
    expect((await reply(sent, "30000000-0000-4000-8000-000000000003")).type).toBe("decline");
    keeper.state.halted = false;
    // A jump against the last round's reference starts the cooldown.
    fresh(105n * USDC);
    deliver(request("30000000-0000-4000-8000-000000000004", 0, NVDA, 120n * USDC));
    expect((await reply(sent, "30000000-0000-4000-8000-000000000004")).type).toBe("decline");
  });

  test("an exchange the guardian paused gets no quotes until it resumes", async () => {
    const { sent, deliver } = connect();
    // The previous test's jump left a cooldown: clear it, so the pause is the only difference.
    const record = keeper.state.markets[1];
    if (record) record.cooldownUntil = 0;
    const reason = keccak256(stringToBytes("incident"));
    await send(node, 0, tx.pause(protocol.exchange, true, reason));
    await synced();
    fresh();
    deliver(request("40000000-0000-4000-8000-000000000001", 0, NVDA, 110n * USDC));
    expect((await reply(sent, "40000000-0000-4000-8000-000000000001")).type).toBe("decline");
    await send(node, 0, tx.pause(protocol.exchange, false, reason));
    await synced();
    fresh();
    deliver(request("40000000-0000-4000-8000-000000000002", 0, NVDA, 110n * USDC));
    expect((await reply(sent, "40000000-0000-4000-8000-000000000002")).type).toBe("quote");
  });
});

async function accountOf(branch: 0 | 1) {
  await synced();
  return (await node.publicClient.readContract({
    address: protocol.exchange,
    abi: tx.conditionalStocksAbi,
    functionName: "account",
    args: [1, branch, vault],
  })) as { quote: bigint; base: bigint; notional: bigint };
}
