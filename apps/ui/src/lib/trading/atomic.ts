import { atomicOrderRouterAbi, conditionalTokensAbi } from "@conditional-stocks/contract-bindings";
import {
  FundingKind,
  hashOrder,
  orderTypedData,
  quoteForReservation,
  Side,
} from "@conditional-stocks/domain";
import { parseAtomicPlan, parseOrder } from "@conditional-stocks/gateway";
import { ATOMIC_EXECUTION_VERSION } from "@conditional-stocks/orderbook";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  zeroAddress,
} from "viem";

export interface AtomicDeployment {
  chainId: number;
  exchange: string;
  atomicRouter: string;
}

/** Approve only the configured exchange, for the exact locally computed reservation. */
export function atomicApproval(input: {
  order: unknown;
  config: AtomicDeployment & { conditionalTokens: string };
  market: { baseToken: string; quoteToken: string };
  response: { to: string; data: string };
}) {
  deployment(input.config);
  const order = parseOrder(input.order);
  const spender = getAddress(input.config.exchange);
  const expected =
    order.fundingKind === FundingKind.WholeCollateral
      ? {
          to: getAddress(
            order.side === Side.Buy ? input.market.quoteToken : input.market.baseToken,
          ),
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [
              spender,
              order.side === Side.Buy
                ? quoteForReservation(order.quantity, order.limitPriceRawX18)
                : order.quantity,
            ],
          }),
        }
      : {
          to: getAddress(input.config.conditionalTokens),
          data: encodeFunctionData({
            abi: conditionalTokensAbi,
            functionName: "setApprovalForAll",
            args: [spender, true],
          }),
        };
  if (
    expected.to === zeroAddress ||
    input.response.to.toLowerCase() !== expected.to.toLowerCase() ||
    input.response.data.toLowerCase() !== expected.data.toLowerCase()
  )
    throw new Error("API approval differs from the exact configured funding requirement");
  return { ...expected, value: "0", chainId: input.config.chainId, from: order.maker };
}

function deployment(config: AtomicDeployment) {
  if (
    !Number.isSafeInteger(config.chainId) ||
    config.chainId <= 0 ||
    getAddress(config.exchange) === zeroAddress ||
    getAddress(config.atomicRouter) === zeroAddress
  )
    throw new Error("Atomic trading contracts are not configured");
  return { chainId: BigInt(config.chainId), verifyingContract: getAddress(config.exchange) };
}

/** Never sign server-provided typed data: bind to the locally configured chain and exchange. */
export function atomicSigningData(orderWire: unknown, config: AtomicDeployment) {
  const typed = orderTypedData(parseOrder(orderWire), deployment(config));
  return JSON.parse(
    JSON.stringify(typed, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  );
}

/** Reconstruct exact reviewed execution bytes before letting a server response reach a wallet. */
export function atomicTransaction(input: {
  order: unknown;
  plan: unknown;
  signature: Hex;
  account: string;
  config: AtomicDeployment;
  nowSeconds?: bigint;
}) {
  const domain = deployment(input.config);
  const order = parseOrder(input.order);
  if (getAddress(order.maker) !== getAddress(input.account))
    throw new Error("Order wallet changed");
  const plan = parseAtomicPlan(input.plan, order);
  const now = input.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  if (plan.deadline <= now || plan.deadline > now + 65n)
    throw new Error("Quote expired or has an invalid deadline; review again");
  return {
    orderHash: hashOrder(order, domain),
    transaction: {
      chainId: input.config.chainId,
      from: getAddress(input.account),
      to: getAddress(input.config.atomicRouter),
      value: "0",
      data: encodeFunctionData({
        abi: atomicOrderRouterAbi,
        functionName: "placeAndMatchChecked",
        args: [
          order,
          input.signature,
          plan.makers,
          plan.quantities,
          plan.expectedRemaining,
          plan.deadline,
          plan.guard,
          plan.releaseOrders,
        ],
      }),
    },
  };
}

export function verifyAtomicResponse(
  expected: ReturnType<typeof atomicTransaction>,
  response: unknown,
) {
  const result = response as {
    orderHash?: string;
    executionVersion?: number;
    transaction?: { chainId?: number; from?: Address; to?: Address; value?: string; data?: string };
  } | null;
  const actual = result?.transaction;
  const wanted = expected.transaction;
  if (
    result?.executionVersion !== ATOMIC_EXECUTION_VERSION ||
    result.orderHash?.toLowerCase() !== expected.orderHash.toLowerCase() ||
    actual?.chainId !== wanted.chainId ||
    actual.from?.toLowerCase() !== wanted.from.toLowerCase() ||
    actual.to?.toLowerCase() !== wanted.to.toLowerCase() ||
    actual.value !== "0" ||
    actual.data?.toLowerCase() !== wanted.data.toLowerCase()
  )
    throw new Error("API transaction does not match the reviewed atomic order");
  return wanted;
}
