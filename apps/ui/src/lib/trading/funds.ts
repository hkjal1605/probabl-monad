import { parseTokenAmount } from "@conditional-stocks/domain";
import { encodeFunctionData, erc20Abi, getAddress, zeroAddress } from "viem";

export function walletTransfer(input: {
  token: string;
  recipient: string;
  amount: string;
  decimals: number;
}) {
  const token = getAddress(input.token),
    recipient = getAddress(input.recipient);
  const amount = parseTokenAmount(input.amount.trim(), input.decimals);
  if (
    token === zeroAddress ||
    recipient === zeroAddress ||
    recipient === token ||
    amount <= 0n ||
    amount >= 1n << 256n
  )
    throw new Error("Invalid transfer amount or recipient");
  return {
    to: token,
    value: "0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, amount],
    }),
  };
}
