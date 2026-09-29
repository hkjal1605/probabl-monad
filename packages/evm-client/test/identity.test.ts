import { expect, test } from "bun:test";
import { encodeAbiParameters, keccak256, stringToHex, zeroHash } from "viem";
import {
  eventKey,
  marketKey,
  marketSlug,
  parseMarketRef,
  publicMarketId,
  underlyingId,
  underlyingSymbol,
} from "../src/identity.ts";

const condition = keccak256(stringToHex("condition"));

test("underlyings are left-aligned bytes32 strings, as the contract's bytes32 literal", () => {
  const id = underlyingId("US:NVDA");
  expect(id).toBe(stringToHex("US:NVDA", { size: 32 }));
  expect(underlyingSymbol(id)).toBe("US:NVDA");
  expect(underlyingSymbol(zeroHash)).toBeNull();
  expect(underlyingSymbol(underlyingId("US:BRK.B"))).toBe("US:BRK.B");
  for (const bad of ["NVDA", "us:NVDA", "US:", "US:NV DA", `US:${"A".repeat(24)}`])
    expect(() => underlyingId(bad)).toThrow();
});

test("keys match the contract's abi.encode hashing; YES orientation is part of the event", () => {
  const event = eventKey(condition, 1, 2);
  expect(event).toBe(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint8" }, { type: "uint8" }],
        [condition, 1, 2],
      ),
    ),
  );
  expect(eventKey(condition, 2, 1)).not.toBe(event);
  const key = marketKey(event, underlyingId("US:NVDA"));
  expect(key).not.toBe(marketKey(event, underlyingId("US:TSLA")));
  expect(publicMarketId(key)).toBe(key.slice(2, 18));
  expect(marketSlug(publicMarketId(key), "US:BRK.B")).toBe(`brk-b-${key.slice(2, 18)}`);
  expect(marketSlug("00000000000000a1", null)).toBe("00000000000000a1");
});

test("market references: public id, slug, full key, or an on-chain id", () => {
  const key = marketKey(eventKey(condition, 1, 2), underlyingId("US:NVDA"));
  const publicId = publicMarketId(key);
  expect(parseMarketRef(publicId)).toEqual({ publicId });
  expect(parseMarketRef(`nvda-${publicId}`)).toEqual({ publicId });
  expect(parseMarketRef(key)).toEqual({ publicId });
  expect(parseMarketRef("42")).toEqual({ venueId: 42 });
  expect(parseMarketRef("4294967295")).toEqual({ venueId: 4_294_967_295 });
  for (const bad of ["0", "4294967296", "01", "nvda", "", `${publicId}0`, "0x1234"])
    expect(parseMarketRef(bad)).toBeNull();
});
