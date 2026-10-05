import { address, approve, deposit, unsigned, withdraw } from "@conditional-stocks/evm-client";
import { creditOf } from "@conditional-stocks/evm-client/ledger";
import type { IndexerService } from "@conditional-stocks/indexer";
import type { Hono } from "hono";
import { erc20Abi, type PublicClient } from "viem";
import type { Auth } from "../auth/routes.ts";

/** Vault transfers of the authenticated wallet only; no caller-supplied owner is accepted. */
export function mountCustody(app: Hono, indexer: IndexerService, client: PublicClient, auth: Auth) {
  const prepare = async (
    owner: `0x${string}`,
    body: { asset?: string; amount?: string; recipient?: string },
    action: "deposit" | "withdraw",
  ) => {
    const s = indexer.trading();
    const token = address(body.asset);
    const amount = unsigned(body.amount);
    if (!amount) throw new Error("Amount must be positive");
    if (!s.pools.has(token)) throw new Error("Token is not listed in this deployment");
    const exchange = indexer.options.exchange;
    if (action === "withdraw") {
      if (creditOf(s, owner, token) < amount)
        throw new Error("Insufficient available vault balance");
      return {
        transactions: [
          withdraw(exchange, token, amount, body.recipient ? address(body.recipient) : owner),
        ],
      };
    }
    const [balance, allowance] = await Promise.all([
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, exchange],
      }),
    ]);
    if (balance < amount) throw new Error("Insufficient wallet balance");
    return {
      transactions: [
        ...(allowance < amount ? [approve(token, exchange, amount)] : []),
        deposit(exchange, token, amount),
      ],
    };
  };
  for (const action of ["deposit", "withdraw"] as const)
    app.post(`/v1/vault/${action}/prepare`, async (c) => {
      // Depositing is for trading; withdrawing the wallet's own credit only needs a session.
      const { owner } = action === "deposit" ? await auth.trader(c) : await auth.session(c);
      return c.json(await prepare(owner, await c.req.json(), action));
    });
  app.post("/v1/payouts/withdraw/prepare", async (c) => {
    const { owner } = await auth.session(c);
    return c.json(await prepare(owner, await c.req.json(), "withdraw"));
  });
}
