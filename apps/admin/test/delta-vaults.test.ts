import { expect, test } from "bun:test";
import {
  deltaVaultAbi,
  deltaVaultAddMarket,
  deltaVaultPause,
  deltaVaultSetCaps,
} from "@conditional-stocks/evm-client";
import { decodeFunctionData, getAddress } from "viem";
import { adminConfig } from "../src/config/protocol";
import {
  limitsFromForm,
  riskFromForm,
  vaultOperators,
  vaultTransaction,
} from "../src/lib/delta-vaults";
import { loadOperators, operatorRole } from "../src/lib/operator-access";

const VAULT = getAddress("0x00000000000000000000000000000000000000a1");
const OTHER = getAddress("0x00000000000000000000000000000000000000a2");
const ADMIN = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const CURATOR = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
const KEEPER = getAddress("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
const none = { admin: false, curator: false, keeper: false, guardian: false };

test("risk forms become exact contract units and invalid limits are refused", () => {
  const risk = riskFromForm(
    {
      bandPercent: "7.5",
      cutoffBufferMinutes: "90",
      maxOrder: "5000",
      maxResting: "50000.5",
      maxImbalance: "120.25",
    },
    { quote: 6, base: 18 },
  );
  expect(risk).toEqual({
    bandBps: 750,
    cutoffBuffer: 5400,
    maxOrder: 5_000_000_000n,
    maxResting: 50_000_500_000n,
    maxImbalance: 120_250_000_000_000_000_000n,
  });
  const base = {
    bandPercent: "10",
    cutoffBufferMinutes: "60",
    maxOrder: "10",
    maxResting: "20",
    maxImbalance: "1",
  };
  expect(() => riskFromForm({ ...base, maxOrder: "30" }, { quote: 6, base: 18 })).toThrow();
  expect(() => riskFromForm({ ...base, bandPercent: "51" }, { quote: 6, base: 18 })).toThrow();
  expect(() => riskFromForm({ ...base, maxOrder: "1.0000001" }, { quote: 6, base: 18 })).toThrow();
});

test("limit forms convert minutes and hours and respect the contract bounds", () => {
  expect(limitsFromForm({ ttlMinutes: "5", oracleAgeHours: "25", maxFeeBps: "50" })).toEqual({
    maxTtl: 300,
    maxOracleAge: 90_000,
    maxFeeBps: 50,
  });
  expect(() =>
    limitsFromForm({ ttlMinutes: "1441", oracleAgeHours: "1", maxFeeBps: "0" }),
  ).toThrow();
  expect(() => limitsFromForm({ ttlMinutes: "5", oracleAgeHours: "73", maxFeeBps: "0" })).toThrow();
});

test("vault calls are signed by the operator on the configured chain", () => {
  const pause = vaultTransaction(deltaVaultPause(VAULT), ADMIN);
  expect(pause).toMatchObject({ to: VAULT, from: ADMIN, chainId: adminConfig.chainId, value: "0" });
  expect(decodeFunctionData({ abi: deltaVaultAbi, data: pause.data }).functionName).toBe("pause");
  const caps = decodeFunctionData({
    abi: deltaVaultAbi,
    data: deltaVaultSetCaps(VAULT, 7n, 9n).data,
  });
  expect(caps.functionName).toBe("setCaps");
  expect(caps.args).toEqual([7n, 9n]);
  const add = decodeFunctionData({
    abi: deltaVaultAbi,
    data: deltaVaultAddMarket(VAULT, 3, {
      bandBps: 500,
      cutoffBuffer: 60,
      maxOrder: 1n,
      maxResting: 2n,
      maxImbalance: 3n,
    }).data,
  });
  expect(add.functionName).toBe("addMarket");
  expect(add.args?.[0]).toBe(3);
});

test("vault admins, curators and guardians reach the console; keepers do not", async () => {
  const admins = async () => ADMIN;
  const roles = (curatorOf: string) => async (vault: string, account: string) => ({
    ...none,
    curator: vault === curatorOf && account === CURATOR,
    keeper: account === KEEPER,
  });
  expect(await vaultOperators(CURATOR, [VAULT, OTHER], roles(OTHER), admins)).toEqual([
    ADMIN,
    ADMIN,
    CURATOR,
  ]);
  expect(await vaultOperators(KEEPER, [VAULT], roles(VAULT), admins)).toEqual([ADMIN]);
  const exchange = {
    admin: getAddress("0x0000000000000000000000000000000000000001"),
    marketAdmin: getAddress("0x0000000000000000000000000000000000000002"),
    resolutionAdmin: getAddress("0x0000000000000000000000000000000000000003"),
    guardian: getAddress("0x0000000000000000000000000000000000000004"),
    quote: getAddress("0x0000000000000000000000000000000000000005"),
  };
  const operators = await loadOperators(
    async () => exchange,
    () => vaultOperators(CURATOR, [VAULT], roles(VAULT), admins),
  );
  expect(operatorRole(CURATOR, operators)).toBe("operator");
  expect(operatorRole(KEEPER, operators)).toBe("blocked");
});
