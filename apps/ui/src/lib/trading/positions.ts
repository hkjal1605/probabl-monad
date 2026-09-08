import { conditionalTokensAbi, positionRouterAbi } from "@conditional-stocks/contract-bindings";
import { encodeFunctionData, getAddress, type Hex, isHex, zeroAddress } from "viem";
import { verifyPayoutResponse } from "./payouts";

export function positionAction(input: {
  kind: "merge" | "redeem";
  collateralToken: string;
  conditionId: string;
  amount: bigint;
  branch: "yes" | "no";
  account: string;
  config: { chainId: number; conditionalTokens: string; positionRouter: string };
}) {
  const { config, amount } = input;
  const from = getAddress(input.account),
    to = getAddress(config.positionRouter),
    ctf = getAddress(config.conditionalTokens),
    collateral = getAddress(input.collateralToken);
  if (
    [from, to, ctf, collateral].includes(zeroAddress) ||
    amount <= 0n ||
    amount >= 1n << 256n ||
    !Number.isSafeInteger(config.chainId) ||
    config.chainId <= 0 ||
    !isHex(input.conditionId, { strict: true }) ||
    input.conditionId.length !== 66
  )
    throw new Error("Invalid position action or deployment configuration");
  const condition = input.conditionId as Hex;
  const data =
    input.kind === "merge"
      ? encodeFunctionData({
          abi: positionRouterAbi,
          functionName: "mergeForUser",
          args: [collateral, condition, amount, from],
        })
      : encodeFunctionData({
          abi: positionRouterAbi,
          functionName: "redeemForUser",
          args: [collateral, condition, [input.branch === "yes" ? 1n : 2n], [amount], from],
        });
  return {
    transaction: { chainId: config.chainId, from, to, data, value: "0" },
    approval: {
      chainId: config.chainId,
      from,
      to: ctf,
      value: "0",
      data: encodeFunctionData({
        abi: conditionalTokensAbi,
        functionName: "setApprovalForAll",
        args: [to, true],
      }),
    },
  };
}

export function verifyPositionResponse(
  expected: ReturnType<typeof positionAction>,
  response: unknown,
) {
  const value = response as { transaction?: unknown; approval?: unknown; approved?: boolean };
  verifyPayoutResponse(expected.transaction, value);
  if (value.approved === true && value.approval === null)
    return { transaction: expected.transaction, approval: null };
  if (value.approved !== false || !value.approval)
    throw new Error("Invalid position approval response");
  verifyPayoutResponse(expected.approval, { transaction: value.approval });
  return expected;
}
