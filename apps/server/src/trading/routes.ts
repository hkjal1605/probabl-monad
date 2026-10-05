import {
  address,
  cancel,
  type OrderWire,
  parseAtomicPlan,
  parseOrder,
  placement,
  protocolErrorMessage,
} from "@conditional-stocks/evm-client";
import type { IndexerService } from "@conditional-stocks/indexer";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PublicClient } from "viem";
import type { Auth } from "../auth/routes.ts";
import { type DelegatedTrading, type TradingSigner, tradingPermission } from "./delegated.ts";
import type { OrderPlanner } from "./plan.ts";

export function mountTrading(
  app: Hono,
  options: {
    indexer: IndexerService;
    client: PublicClient;
    auth: Auth;
    prepare: OrderPlanner;
    signer: TradingSigner | null;
    delegated: DelegatedTrading | null;
  },
) {
  const { indexer, client, auth, prepare, signer, delegated } = options;
  // Read-only planning (no signing, broadcasting or state writes), for members' own orders.
  app.post("/v1/orders/prepare", async (c) => {
    const order = parseOrder((await c.req.json()).order);
    await auth.trader(c, order.maker);
    return c.json(prepare(order));
  });

  /** Owner-signed placement: the reviewed plan as wallet calldata, simulated first. */
  app.post("/v1/orders/transaction", async (c) => {
    const { owner } = await auth.trader(c);
    const body = await c.req.json();
    const order = parseOrder(body.order);
    if ((order.delegate ?? order.maker) !== owner)
      throw new HTTPException(403, { message: "Order signer differs from session wallet" });
    const plan = parseAtomicPlan(body.plan, order);
    if (BigInt(plan.deadline) <= BigInt(Math.floor(Date.now() / 1000)))
      throw new Error("Quote expired");
    const m = indexer.trading().markets.get(Number(order.marketId));
    if (!m) throw new Error("Unknown market");
    const transaction = placement(indexer.options.exchange, order, plan, m.tick);
    try {
      await client.call({
        account: owner as `0x${string}`,
        to: transaction.to,
        data: transaction.data,
      });
    } catch (error) {
      throw new Error(protocolErrorMessage(error, "Placement simulation failed"));
    }
    return c.json({ transaction, executionVersion: 1 });
  });

  app.get("/v1/trading/permission", async (c) => {
    const { owner } = await auth.member(c, c.req.query("owner") ?? null);
    return c.json(tradingPermission(indexer, signer, owner));
  });
  app.post("/v1/trading/submit", async (c) => {
    const { owner } = await auth.trader(c);
    if (!delegated) throw new HTTPException(503, { message: "Delegated trading is unavailable" });
    const body = (await c.req.json()) as { order: OrderWire; clientId: string };
    return c.json(await delegated.submit(address(owner), body.order, String(body.clientId ?? "")));
  });

  /** Cancellation (owner) or permissionless release of an order that can no longer fill. */
  for (const kind of ["cancel", "recovery"])
    app.post(`/v1/orders/${kind}/prepare`, async (c) => {
      // Cancelling returns the wallet's own reservation: signing in is enough.
      const { owner } = await auth.session(c);
      const key = String((await c.req.json()).orderHash ?? "");
      if (!/^\d{1,30}$/.test(key)) throw new Error("Invalid order id");
      const order = indexer.trading().orders.get(key);
      if (!order || order.status !== "open") throw new Error("Unknown or closed order");
      const transaction = cancel(indexer.options.exchange, key);
      try {
        await client.call({
          account: owner as `0x${string}`,
          to: transaction.to,
          data: transaction.data,
        });
      } catch (error) {
        throw new Error(
          protocolErrorMessage(error, "This order cannot be cancelled by this wallet now"),
        );
      }
      return c.json({ transaction });
    });
}
