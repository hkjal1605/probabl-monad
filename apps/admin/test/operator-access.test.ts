import { expect, test } from "bun:test";
import { loadOperators, operatorRole } from "../src/lib/operator-access";

const addresses = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
] as const;
const roles = {
  admin: addresses[0],
  marketAdmin: addresses[1],
  resolutionAdmin: addresses[2],
  guardian: addresses[3],
  quote: addresses[4],
};

test("unconnected, pending and failed lookups are unverified, never blocked or authorized", () => {
  expect(operatorRole(null, null)).toBe("unverified");
  expect(operatorRole(addresses[0], null)).toBe("unverified");
  expect(operatorRole(null, [addresses[0]])).toBe("unverified");
  expect(operatorRole(addresses[0], [])).toBe("blocked");
});

test("all four live roles are operators; unrelated wallets are blocked", async () => {
  const operators = await loadOperators(async () => roles);
  for (const address of addresses.slice(0, 4))
    expect(operatorRole(address, operators)).toBe("operator");
  expect(operatorRole(addresses[4], operators)).toBe("blocked");
});

test("network and role-read errors stay visible for retry and never grant access", async () => {
  for (const message of ["RPC offline", "The RPC does not serve Anvil."])
    await expect(
      loadOperators(async () => {
        throw new Error(message);
      }),
    ).rejects.toThrow(message);
});

test("a fresh role lookup honors authority rotation", async () => {
  const operators = await loadOperators(async () => ({ ...roles, admin: addresses[4] }));
  expect(operatorRole(addresses[0], operators)).toBe("blocked");
  expect(operatorRole(addresses[4], operators)).toBe("operator");
});
