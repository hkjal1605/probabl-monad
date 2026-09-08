import { expect, test } from "bun:test";
import {
  conditionalExchangeAbi,
  payoutVaultAbi,
  positionRouterAbi,
} from "@conditional-stocks/contract-bindings";
import { decodeFunctionData, toHex, zeroAddress } from "viem";
import { payoutWithdrawal, verifyPayoutResponse } from "../src/lib/trading/payouts";
import { positionAction, verifyPositionResponse } from "../src/lib/trading/positions";
import { orderRecovery, verifyRecoveryResponse } from "../src/lib/trading/recovery";

const account = "0x1000000000000000000000000000000000000001";
const destination = "0x2000000000000000000000000000000000000002";
const vault = "0x3000000000000000000000000000000000000003";
const ctf = "0x4000000000000000000000000000000000000004";
const config = { chainId: 4663, payoutVault: vault, conditionalTokens: ctf, exchange: vault };
const credit = {
  beneficiary: account,
  asset: ctf,
  tokenId: String((1n << 256n) - 1n),
  amount: "1000000000000000001",
};
const input = { credit, amount: 1n, recipient: destination, account, config };

test("merge/redemption and operator approval are locally bound, with no server-selected operator or amounts", () => {
  for (const kind of ["merge", "redeem"] as const)
    for (const branch of ["yes", "no"] as const) {
      const expected = positionAction({
        kind,
        branch,
        collateralToken: destination,
        conditionId: toHex(1, { size: 32 }),
        amount: 1_000_001n,
        account,
        config: { ...config, positionRouter: vault },
      });
      expect(
        decodeFunctionData({ abi: positionRouterAbi, data: expected.transaction.data })
          .functionName,
      ).toBe(kind === "merge" ? "mergeForUser" : "redeemForUser");
      expect(verifyPositionResponse(expected, { ...expected, approved: false })).toBe(expected);
      expect(
        verifyPositionResponse(expected, {
          transaction: expected.transaction,
          approval: null,
          approved: true,
        }).approval,
      ).toBeNull();
      for (const changed of [{ to: destination }, { data: "0x" }, { value: "1" }, { chainId: 1 }]) {
        expect(() =>
          verifyPositionResponse(expected, {
            ...expected,
            approved: false,
            approval: { ...expected.approval, ...changed },
          }),
        ).toThrow();
        expect(() =>
          verifyPositionResponse(expected, {
            ...expected,
            approved: false,
            transaction: { ...expected.transaction, ...changed },
          }),
        ).toThrow();
      }
    }
});

test("withdrawal binds beneficiary, alternate recipient and exact raw units, including uint256 IDs", () => {
  const tx = payoutWithdrawal(input);
  expect(decodeFunctionData({ abi: payoutVaultAbi, data: tx.data }).args).toEqual([
    ctf,
    (1n << 256n) - 1n,
    1n,
    destination,
  ]);
  expect(verifyPayoutResponse(tx, { transaction: tx })).toEqual(tx);
  for (const patch of [
    { to: account },
    { from: destination },
    { value: "1" },
    { chainId: 1 },
    { data: "0x" },
  ])
    expect(() => verifyPayoutResponse(tx, { transaction: { ...tx, ...patch } })).toThrow();
  for (const value of [null, {}, { transaction: null }])
    expect(() => verifyPayoutResponse(tx, value)).toThrow();
  for (const patch of [
    { amount: 0n },
    { amount: -1n },
    { amount: 1n << 256n },
    { recipient: zeroAddress },
    { recipient: vault },
    { account: destination },
  ])
    expect(() => payoutWithdrawal({ ...input, ...patch })).toThrow();
  for (const patch of [
    { tokenId: "01" },
    { tokenId: String(1n << 256n) },
    { amount: "-1" },
    { asset: destination },
    { beneficiary: destination },
  ])
    expect(() => payoutWithdrawal({ ...input, credit: { ...credit, ...patch } })).toThrow();
  const whole = payoutWithdrawal({
    ...input,
    credit: { ...credit, asset: destination, tokenId: "0" },
  });
  expect(decodeFunctionData({ abi: payoutVaultAbi, data: whole.data }).args).toEqual([
    destination,
    0n,
    1n,
    destination,
  ]);
});

test("all recovery buttons bind the reviewed order, method, exchange, signer and zero ETH", () => {
  for (const [kind, name] of Object.entries({
    cancel: "cancelOrder",
    expired: "releaseExpiredOrder",
    invalidated: "releaseInvalidatedOrder",
    closed: "releaseClosedMarketOrder",
  })) {
    const tx = orderRecovery({
      orderHash: toHex(1, { size: 32 }),
      kind: kind as "cancel",
      account,
      config,
    });
    expect(
      String(decodeFunctionData({ abi: conditionalExchangeAbi, data: tx.data }).functionName),
    ).toBe(name);
    expect(verifyRecoveryResponse(tx, { transaction: tx })).toBe(tx);
    expect(() => verifyRecoveryResponse(tx, { transaction: { ...tx, to: destination } })).toThrow();
  }
  expect(() => orderRecovery({ orderHash: "0x01", kind: "cancel", account, config })).toThrow();
});
