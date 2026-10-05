import { expect, test } from "bun:test";
import { getAddress, recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import {
  assertSignInChallenge,
  SIGN_IN_STATEMENT,
  signInInvite,
  signInMessage,
} from "../src/protocol.ts";

const deployment = {
  chainId: 31337,
  exchange: getAddress("0x5fbdb2315678afecb367f032d93f642f64180aa3"),
};
const wallet = privateKeyToAccount(`0x${"11".repeat(32)}`);
const origin = "https://app.probabl.trade";
const nonce = "ab".repeat(32);
const NOW = Date.parse("2026-10-05T12:00:00Z");
const message = (options: { invite?: string; expires?: number; issued?: number } = {}) =>
  signInMessage(
    deployment,
    origin,
    wallet.address,
    nonce,
    new Date(options.expires ?? NOW + 120_000),
    { issuedAt: new Date(options.issued ?? NOW), invite: options.invite ?? null },
  );

test("sign-in is a standard SIWE message bound to the page, chain and exchange", () => {
  const text = message();
  expect(text.split("\n")[0]).toBe(
    "app.probabl.trade wants you to sign in with your Ethereum account:",
  );
  const m = parseSiweMessage(text);
  expect(m).toMatchObject({
    domain: "app.probabl.trade",
    address: wallet.address,
    statement: SIGN_IN_STATEMENT,
    uri: origin,
    version: "1",
    chainId: 31337,
    nonce,
    resources: [`urn:probabl:exchange:${deployment.exchange}`],
  });
  expect(signInInvite(text)).toBeNull();
  expect(() =>
    assertSignInChallenge(
      { challengeId: nonce, message: text },
      wallet.address,
      deployment,
      origin,
    ),
  ).not.toThrow();
});

test("an invite code rides in the same message, so one signature signs in and joins", () => {
  const text = message({ invite: "7K4MQ2XD" });
  expect(signInInvite(text)).toBe("7K4MQ2XD");
  expect(() =>
    assertSignInChallenge(
      { challengeId: nonce, message: text },
      wallet.address,
      deployment,
      origin,
      "7K4MQ2XD",
    ),
  ).not.toThrow();
  // The page only signs the code it asked for.
  for (const expected of [null, "7K4MQ2XE"])
    expect(() =>
      assertSignInChallenge(
        { challengeId: nonce, message: text },
        wallet.address,
        deployment,
        origin,
        expected,
      ),
    ).toThrow("differs");
});

test("a challenge for another page, wallet, chain, exchange or nonce is refused", () => {
  const text = message();
  const check = (
    overrides: Partial<{
      id: string;
      owner: string;
      chainId: number;
      exchange: string;
      page: string;
    }>,
    body = text,
  ) =>
    assertSignInChallenge(
      { challengeId: overrides.id ?? nonce, message: body },
      overrides.owner ?? wallet.address,
      {
        chainId: overrides.chainId ?? deployment.chainId,
        exchange: (overrides.exchange ?? deployment.exchange) as `0x${string}`,
      },
      overrides.page ?? origin,
    );
  expect(() => check({ page: "https://evil.example" })).toThrow("differs");
  expect(() => check({ page: "http://app.probabl.trade" })).toThrow("differs");
  expect(() => check({ owner: getAddress(`0x${"22".repeat(20)}`) })).toThrow("differs");
  expect(() => check({ chainId: 1 })).toThrow("differs");
  expect(() => check({ exchange: getAddress(`0x${"33".repeat(20)}`) })).toThrow("differs");
  expect(() => check({ id: "cd".repeat(32) })).toThrow("differs");
  // Text the fields do not account for (an extra line) is refused even when every field matches.
  expect(() => check({}, text.replace("Version: 1", "Version: 1\nRequest ID: 7"))).toThrow(
    "differs",
  );
  expect(() => check({}, `${text}\n`)).toThrow("differs");
});

test("only a short-lived challenge is signed, whatever this page's clock says", () => {
  const check = (expires: number, issued = NOW) =>
    assertSignInChallenge(
      { challengeId: nonce, message: message({ expires, issued }) },
      wallet.address,
      deployment,
      origin,
    );
  expect(() => check(NOW + 150_000)).not.toThrow();
  expect(() => check(NOW)).toThrow("expired");
  expect(() => check(NOW - 1)).toThrow("lifetime");
  expect(() => check(NOW + 3_600_000)).toThrow("lifetime");
  expect(() => check(NOW + 150_001)).toThrow("lifetime");
  // Both times are the API's: a page clock hours or days off still signs in.
  expect(() => check(NOW + 10 * 86_400_000 + 120_000, NOW + 10 * 86_400_000)).not.toThrow();
  expect(() => check(NOW - 86_400_000 + 120_000, NOW - 86_400_000)).not.toThrow();
});

test("the wallet's signature over the message recovers to the signing wallet", async () => {
  const text = message({ invite: "7K4MQ2XD" });
  const signature = await wallet.signMessage({ message: text });
  expect(await recoverMessageAddress({ message: text, signature })).toBe(wallet.address);
});
