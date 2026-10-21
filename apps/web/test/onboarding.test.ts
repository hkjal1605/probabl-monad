import { expect, test } from "bun:test";
import {
  networkName,
  onboardingStep,
  readOnboarding,
  writeOnboarding,
} from "../src/lib/onboarding";
import { parseFaucetStatus } from "../src/services/faucet";

test("the guide opens at the first step a wallet has not done, in order", () => {
  const at = (
    onNetwork: boolean,
    access: Parameters<typeof onboardingStep>[0]["access"],
    funded = false,
  ) => onboardingStep({ onNetwork, access, funded });
  // The network comes first, even for a wallet that is already signed in.
  expect(at(false, "signed-out")).toBe("network");
  expect(at(false, "member", true)).toBe("network");
  expect(at(true, "signed-out")).toBe("sign-in");
  // Signed in without an invite: still signing in (joining) until a member.
  expect(at(true, "invite-required")).toBe("sign-in");
  expect(at(true, "member")).toBe("tokens");
  expect(at(true, "suspended")).toBe("tokens");
  expect(at(true, "member", true)).toBe("done");
});

test("progress is kept per deployment and wallet, and survives bad storage", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  const owner = "0x1111111111111111111111111111111111111111";
  expect(readOnboarding(storage, "46630:0xabc", owner)).toBeNull();
  writeOnboarding(storage, "46630:0xabc", owner, "active");
  writeOnboarding(storage, "46630:0xabc", "0x2222222222222222222222222222222222222222", "done");
  expect(readOnboarding(storage, "46630:0xabc", owner.toUpperCase().replace("0X", "0x"))).toBe(
    "active",
  );
  expect(readOnboarding(storage, "31337:0xdef", owner)).toBeNull();
  writeOnboarding(storage, "46630:0xabc", owner, "dismissed");
  expect(readOnboarding(storage, "46630:0xabc", owner)).toBe("dismissed");
  data.set("probabl:onboarding:v1", "not json");
  expect(readOnboarding(storage, "46630:0xabc", owner)).toBeNull();
  writeOnboarding(storage, "46630:0xabc", owner, "done");
  expect(readOnboarding(storage, "46630:0xabc", owner)).toBe("done");
  expect(readOnboarding(null, "46630:0xabc", owner)).toBeNull();
});

test("faucet status and network names read defensively", () => {
  expect(
    parseFaucetStatus({
      available: true,
      claimed: false,
      tokens: [{ token: "0x1", symbol: "USDG" }, { bad: true }],
      quoteUnits: 10_000,
      assetUsd: 1_000,
    }),
  ).toEqual({
    available: true,
    claimed: false,
    tokens: [{ token: "0x1", symbol: "USDG" }],
    quoteUnits: 10_000,
    assetUsd: 1_000,
  });
  // An API without the faucet answers only availability.
  expect(parseFaucetStatus({ available: false, claimed: false })).toMatchObject({
    available: false,
    tokens: [],
  });
  expect(() => parseFaucetStatus(null)).toThrow();
  expect(networkName(1)).toBe("Ethereum");
  expect(networkName(999)).toBe("Chain 999");
});
