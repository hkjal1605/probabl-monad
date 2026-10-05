import {
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
  createPublicClient,
  custom,
  encodeFunctionData,
  getAbiItem,
  type PublicClient,
} from "viem";

// A deployless multicall (`deployless: true`) runs as one eth_call whose initcode deploys
// Multicall3 and returns the results as the created code, so two EVM limits bound it, eth_call
// included: 49,152 bytes of initcode (EIP-3860), of which Multicall3 and the wrapper take about
// 6.2 KB, and 24,576 bytes of code (EIP-170) for the results. Both budgets leave margin.
const CALLS_BUDGET = 40_000;
const RESULTS_BUDGET = 22_000;

/** viem's implicit multicall batching splits by the calls' raw calldata only. A 4-byte call
 * encodes to 192 bytes and a result of up to 4 words to 256, so batches of up to 360 raw
 * bytes (90 calls) fit both limits when every read returns at most 4 words. Bulk reads use
 * `deploylessMulticall`, which sizes both sides exactly. */
export const DEPLOYLESS_BATCH_SIZE = 360;

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

/** Bytes of a statically sized ABI value; undefined for dynamic ones. */
function staticSize(param: AbiParameter): number | undefined {
  const array = /^(.*)\[(\d*)\]$/.exec(param.type);
  if (array) {
    if (!array[2]) return undefined;
    const item = staticSize({ ...param, type: array[1]! } as AbiParameter);
    return item === undefined ? undefined : item * Number(array[2]);
  }
  if (param.type === "tuple") {
    let size = 0;
    for (const component of (param as { components: readonly AbiParameter[] }).components) {
      const part = staticSize(component);
      if (part === undefined) return undefined;
      size += part;
    }
    return size;
  }
  return param.type === "string" || param.type === "bytes" ? undefined : 32;
}

/** Bytes one call adds to the `aggregate3` calldata and to its result: per call, 160 bytes of
 * encoding and its calldata padded to words; per result, 128 bytes and the returned data. */
function sizes(call: ContractCall) {
  const callData = encodeFunctionData(call as never);
  const fn = getAbiItem({ abi: call.abi, name: call.functionName, args: call.args } as never) as
    | AbiFunction
    | undefined;
  let returned = 0;
  for (const output of fn?.outputs ?? []) {
    const size = staticSize(output);
    if (size === undefined)
      throw new Error(
        `${call.functionName} returns dynamic data, which a deployless read cannot size`,
      );
    returned += size;
  }
  return { call: 160 + Math.ceil((callData.length - 2) / 64) * 32, result: 128 + returned };
}

/** Splits calls, in order, into the fewest chunks that each fit one deployless multicall. */
export function deploylessChunks<T extends ContractCall>(calls: readonly T[]): T[][] {
  const chunks: T[][] = [];
  let requested = CALLS_BUDGET,
    returned = RESULTS_BUDGET;
  for (const call of calls) {
    const size = sizes(call);
    if (requested + size.call > CALLS_BUDGET || returned + size.result > RESULTS_BUDGET) {
      chunks.push([]);
      requested = returned = 0;
    }
    chunks.at(-1)!.push(call);
    requested += size.call;
    returned += size.result;
  }
  return chunks;
}

const views = new WeakMap<PublicClient, PublicClient>();
/** The client on the same transport, without implicit multicall batching: a batching client
 * merges concurrent multicalls into one, undoing their chunking. */
export function unbatched(client: PublicClient) {
  let view = views.get(client);
  if (!view) {
    view = createPublicClient({
      chain: client.chain,
      transport: custom({ request: client.request }, { retryCount: 0 }),
    }) as PublicClient;
    views.set(client, view);
  }
  return view;
}

/** The results of every call, in order, from as few deployless multicalls as fit both limits:
 * one eth_call per chunk, sent together. A failing call rejects, as `readContract` does. */
export async function deploylessMulticall(
  client: PublicClient,
  calls: readonly ContractCall[],
  options: { blockNumber?: bigint } = {},
): Promise<unknown[]> {
  const direct = unbatched(client);
  const results = await Promise.all(
    deploylessChunks(calls).map(
      (chunk) =>
        direct.multicall({
          contracts: chunk as never,
          allowFailure: false,
          deployless: true,
          // Already chunked by encoded size: viem's raw-size chunking would only split more.
          batchSize: 0,
          ...options,
        }) as Promise<unknown[]>,
    ),
  );
  return results.flat();
}
