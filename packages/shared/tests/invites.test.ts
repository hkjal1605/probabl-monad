import { expect, test } from "bun:test";
import {
  formatInviteCode,
  generateInviteCode,
  INVITE_ALPHABET,
  normalizeInviteCode,
} from "../src/invites.ts";

test("invite codes read back in canonical form whatever the case, separators or look-alikes", () => {
  expect(normalizeInviteCode("7k4m-q2xd")).toBe("7K4MQ2XD");
  expect(normalizeInviteCode(" 7K4M Q2XD ")).toBe("7K4MQ2XD");
  // I and L read as 1, O as 0: a code read aloud or retyped still matches.
  expect(normalizeInviteCode("OILX-XXXX")).toBe("011XXXXX");
  expect(formatInviteCode("7K4MQ2XD")).toBe("7K4M-Q2XD");
  for (const bad of ["7K4MQ2X", "7K4MQ2XDD", "7K4M-Q2XU", "", 12345678, null, "x".repeat(40)])
    expect(normalizeInviteCode(bad)).toBeNull();
});

test("generated codes are canonical, use the whole alphabet and come from the given source", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2_000; i++) {
    const code = generateInviteCode();
    expect(normalizeInviteCode(code)).toBe(code);
    for (const c of code) seen.add(c);
  }
  expect(seen.size).toBe(INVITE_ALPHABET.length);
  expect(generateInviteCode((bytes) => bytes.fill(33))).toBe("11111111");
});
