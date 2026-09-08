import { payoutVaultAbi } from "@conditional-stocks/contract-bindings";
import { encodeFunctionData, getAddress, zeroAddress } from "viem";

/** Bind every withdrawal field locally; an API response cannot redirect a user's vault credit. */
export function payoutWithdrawal(input: {
  credit: { beneficiary: string; asset: string; tokenId: string; amount: string };
  amount: bigint;
  recipient: string;
  account: string;
  config: { chainId: number; payoutVault: string; conditionalTokens: string };
}) {
  const { credit, config, amount } = input;
  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0)
    throw new Error("Payout chain is not configured");
  const vault = getAddress(config.payoutVault);
  const asset = getAddress(credit.asset);
  const recipient = getAddress(input.recipient);
  const account = getAddress(input.account);
  const uint256 = (value: string) => {
    if (!/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 1n << 256n)
      throw new Error("Invalid raw payout units");
    return BigInt(value);
  };
  const tokenId = uint256(credit.tokenId);
  const available = uint256(credit.amount);
  if (
    getAddress(credit.beneficiary) !== account ||
    amount <= 0n ||
    amount > available ||
    asset === zeroAddress ||
    vault === zeroAddress ||
    recipient === zeroAddress ||
    recipient === vault ||
    (asset !== getAddress(config.conditionalTokens) && tokenId !== 0n)
  )
    throw new Error("Invalid beneficiary, destination, or payout amount");
  return {
    chainId: config.chainId,
    from: account,
    to: vault,
    value: "0",
    data: encodeFunctionData({
      abi: payoutVaultAbi,
      functionName: "withdraw",
      args: [asset, tokenId, amount, recipient],
    }),
  };
}

export function verifyPayoutResponse(
  expected: ReturnType<typeof payoutWithdrawal>,
  response: unknown,
) {
  const actual = (response as { transaction?: Partial<typeof expected> } | null)?.transaction;
  if (
    !actual ||
    actual.chainId !== expected.chainId ||
    actual.value !== "0" ||
    actual.from?.toLowerCase() !== expected.from.toLowerCase() ||
    actual.to?.toLowerCase() !== expected.to.toLowerCase() ||
    actual.data?.toLowerCase() !== expected.data.toLowerCase()
  )
    throw new Error("API withdrawal differs from the payout you reviewed");
  return expected;
}
