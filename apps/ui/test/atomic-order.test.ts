import { expect, test } from "bun:test";
import { atomicOrderRouterAbi, conditionalTokensAbi } from "@conditional-stocks/contract-bindings";
import { decodeFunctionData, encodeFunctionData, erc20Abi } from "viem";
import {
  atomicApproval,
  atomicSigningData,
  atomicTransaction,
  verifyAtomicResponse,
} from "../src/lib/trading/atomic";

const account = "0x1000000000000000000000000000000000000001";
const config = {
  chainId: 31337,
  exchange: "0x2000000000000000000000000000000000000002",
  atomicRouter: "0x3000000000000000000000000000000000000003",
} as const;
const order = {
  maker: account,
  recipient: account,
  marketId: `0x${"11".repeat(32)}`,
  branch: 0,
  side: 0,
  fundingKind: 0,
  quantity: "1000000000000000000",
  limitPriceRawX18: "100000000",
  expiry: "2000",
  nonce: "1",
  salt: `0x${"22".repeat(32)}`,
  tif: 0,
  maxFeeBps: 0,
};
const plan = {
  makers: [],
  quantities: [],
  expectedRemaining: [],
  deadline: "1560",
  guard: { nextSequence: "0", makerFeeBps: 0, takerFeeBps: 0 },
  releaseOrders: [],
};
const input = { order, plan, signature: "0x12" as const, account, config, nowSeconds: 1500n };

test("UI approval binds token, configured spender and exact raw amount for both funding paths", () => {
  const market = { baseToken: account, quoteToken: config.exchange };
  const deployment = { ...config, conditionalTokens: config.atomicRouter };
  for (const side of [0, 1])
    for (const fundingKind of [0, 1]) {
      const response =
        fundingKind === 0
          ? {
              to: side === 0 ? market.quoteToken : market.baseToken,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [config.exchange, side === 0 ? 100_000_000n : 10n ** 18n],
              }),
            }
          : {
              to: deployment.conditionalTokens,
              data: encodeFunctionData({
                abi: conditionalTokensAbi,
                functionName: "setApprovalForAll",
                args: [config.exchange, true],
              }),
            };
      const args = { order: { ...order, side, fundingKind }, config: deployment, market, response };
      expect(atomicApproval(args)).toMatchObject({ ...response, from: account, value: "0" });
      expect(() => atomicApproval({ ...args, response: { ...response, data: "0x" } })).toThrow(
        "differs",
      );
      expect(() =>
        atomicApproval({
          ...args,
          response: { ...response, to: "0x0000000000000000000000000000000000000000" },
        }),
      ).toThrow("differs");
    }
});

test("UI signs locally bound typed data and encodes only the exact reviewed atomic call", () => {
  const typed = atomicSigningData(order, config);
  expect(typed.domain.verifyingContract).toBe(config.exchange);
  expect(typed.domain.chainId).toBe("31337");
  expect(typed.message.quantity).toBe(order.quantity);
  const expected = atomicTransaction(input);
  const decoded = decodeFunctionData({
    abi: atomicOrderRouterAbi,
    data: expected.transaction.data,
  });
  expect(decoded.functionName).toBe("placeAndMatchChecked");
  expect(expected.transaction.to).toBe(config.atomicRouter);
  expect(verifyAtomicResponse(expected, { ...expected, executionVersion: 2 })).toEqual(
    expected.transaction,
  );
});

test("UI rejects modified destination, sender, chain, ETH value, calldata, hash, or execution version", () => {
  const expected = atomicTransaction(input);
  for (const patch of [
    { to: account },
    { from: config.exchange },
    { chainId: 1 },
    { value: "1" },
    { value: 0 },
    { data: "0x" },
  ])
    expect(() =>
      verifyAtomicResponse(expected, {
        ...expected,
        executionVersion: 2,
        transaction: { ...expected.transaction, ...patch },
      }),
    ).toThrow("does not match");
  for (const patch of [{ orderHash: "0x" }, { executionVersion: 1 }, { transaction: null }])
    expect(() =>
      verifyAtomicResponse(expected, { ...expected, executionVersion: 2, ...patch }),
    ).toThrow();
  expect(() => verifyAtomicResponse(expected, null)).toThrow();
});

test("UI cannot broadcast an expired quote, a changed account, missing router, or malformed quantities", () => {
  expect(() => atomicTransaction({ ...input, nowSeconds: 1560n })).toThrow("expired");
  expect(() => atomicTransaction({ ...input, nowSeconds: 1494n })).toThrow("deadline");
  expect(() => atomicTransaction({ ...input, account: config.exchange })).toThrow("wallet");
  expect(() => atomicTransaction({ ...input, config: { ...config, atomicRouter: "" } })).toThrow();
  expect(() => atomicTransaction({ ...input, plan: { ...plan, quantities: [1] } })).toThrow();
  expect(() => atomicTransaction({ ...input, order: { ...order, quantity: 1e18 } })).toThrow();
});
