// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "../../src/ConditionalStocksBase.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { Vm } from "../Base.t.sol";
import { VaultBase } from "./VaultBase.t.sol";

/// @dev RFQ quotes made by the vault: a keeper signs, the vault accepts within its limits, and the
///      exchange fills the vault's holdings inside the taker's placement.
contract VaultQuotesTest is VaultBase {
    uint256 internal constant KEY = 0xC0FFEE;
    address internal quoter;
    IConditionalStocks internal ex;

    function setUp() public override {
        super.setUp();
        quoter = vm.addr(KEY);
        ex = IConditionalStocks(address(cs));
        bytes32 keeperRole = vault.KEEPER_ROLE();
        vm.prank(vaultAdmin);
        vault.grantRole(keeperRole, quoter);
    }

    /// @dev The vault's nonce `n`: its address in the top 160 bits names it as the maker.
    function nonce(uint96 n) internal view returns (uint256) {
        return uint256(uint160(address(vault))) << 96 | n;
    }

    function one(ConditionalStocksBase.Quote memory q)
        internal
        pure
        returns (ConditionalStocksBase.Quote[] memory list)
    {
        list = new ConditionalStocksBase.Quote[](1);
        list[0] = q;
    }

    /// @dev Alice buys `qty` YES at up to `limit` ticks from `q`; returns what she received.
    function buy(ConditionalStocksBase.Quote memory q, uint64 limit, uint256 qty)
        internal
        returns (uint256)
    {
        uint256 before = acct(alice, YES).base;
        takeQuotes(alice, YES, false, false, limit, qty, one(q), 0);
        return acct(alice, YES).base - before;
    }

    function testKeeperSignedQuoteFillsFromTheVault() public {
        IConditionalStocks.Account memory yes0 = ex.account(market, 0, address(vault));
        IConditionalStocks.Account memory no0 = ex.account(market, 1, address(vault));
        uint256 base0 = credit(address(vault), address(stock));
        vm.recordLogs();
        uint256 got = buy(
            signedQuote(KEY, alice, YES, true, false, 10_300, 2 * NVDA, nonce(1), NVDA),
            10_400,
            NVDA
        );
        eq(got, NVDA, "alice gets one YES-stock (fees zero)");
        // The vault sold YES from its stock credit: one share of credit became the NO claim, and
        // it holds the YES quote the share sold for.
        eq(base0 - credit(address(vault), address(stock)), NVDA, "stock credit");
        eq(ex.account(market, 1, address(vault)).base - no0.base, NVDA, "NO stock claim");
        eq(ex.account(market, 0, address(vault)).quote - yes0.quote, 103e6, "YES quote claim");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == ConditionalStocksBase.QuoteFilled.selector) {
                eq(uint256(logs[i].topics[2]), uint256(uint160(address(vault))), "maker");
                seen = true;
            }
        }
        ok(seen, "QuoteFilled");
        // The nonce is spent: the same quote fills nothing again.
        eq(
            buy(
                signedQuote(KEY, alice, YES, true, false, 10_300, 2 * NVDA, nonce(1), NVDA),
                10_400,
                NVDA
            ),
            0,
            "replay"
        );
    }

    function testOnlyAKeeperSignatureWithinTheVaultsLimitsFills() public {
        // Not a keeper.
        eq(
            buy(
                signedQuote(0xBAD, alice, YES, true, false, 10_300, NVDA, nonce(1), NVDA),
                10_400,
                NVDA
            ),
            0,
            "stranger"
        );
        // Outside the 10% band around the $100 oracle price.
        eq(
            buy(
                signedQuote(KEY, alice, YES, true, false, 11_100, NVDA, nonce(2), NVDA),
                11_200,
                NVDA
            ),
            0,
            "band"
        );
        // Above the order cap ($50k at most).
        eq(
            buy(
                signedQuote(KEY, alice, YES, true, false, 10_300, 600 * NVDA, nonce(3), NVDA),
                10_400,
                NVDA
            ),
            0,
            "order cap"
        );
        // Beyond the 200-share imbalance cap once filled.
        eq(
            buy(
                signedQuote(KEY, alice, YES, true, false, 10_300, 201 * NVDA, nonce(4), 201 * NVDA),
                10_400,
                201 * NVDA
            ),
            0,
            "imbalance cap"
        );
        // Within every limit: fills.
        eq(
            buy(
                signedQuote(KEY, alice, YES, true, false, 10_300, 200 * NVDA, nonce(5), 200 * NVDA),
                10_400,
                200 * NVDA
            ),
            200 * NVDA,
            "at the cap"
        );
        // Alice sells one back into a vault bid (from its quote credit), then the vault pauses
        // and the same trade fills nothing.
        uint256 held = acct(alice, YES).base;
        takeQuotes(
            alice,
            YES,
            true,
            true,
            9_000,
            NVDA,
            one(signedQuote(KEY, alice, YES, false, false, 9_700, NVDA, nonce(6), NVDA)),
            0
        );
        eq(held - acct(alice, YES).base, NVDA, "a bid fills");
        vm.prank(sentinel);
        ops.pause();
        takeQuotes(
            alice,
            YES,
            true,
            true,
            9_000,
            NVDA,
            one(signedQuote(KEY, alice, YES, false, false, 9_700, NVDA, nonce(7), NVDA)),
            0
        );
        eq(held - acct(alice, YES).base, NVDA, "paused");
    }

    function testAQuoteOutlivingTheVaultsLimitsIsRefused() public {
        uint256 terms = pack(
            O(market, YES, true, false, false, 0, uint40(now_() + 11 minutes), 10_300, NVDA)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, quoteDigest(alice, terms, nonce(1)));
        ConditionalStocksBase.Quote memory q = ConditionalStocksBase.Quote(
            terms, nonce(1), NVDA, r, bytes32(uint256(s) | (v == 28 ? uint256(1) << 255 : 0))
        );
        eq(buy(q, 10_400, NVDA), 0, "longer than the 10-minute lifetime");
    }

    function testTheVaultVouchesForItsKeepersSignatures() public view {
        bytes32 digest = keccak256("anything");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, digest);
        ok(ops.isValidSignature(digest, abi.encodePacked(r, s, v)) == 0x1626ba7e, "65 bytes");
        bytes32 vs = bytes32(uint256(s) | (v == 28 ? uint256(1) << 255 : 0));
        ok(ops.isValidSignature(digest, abi.encodePacked(r, vs)) == 0x1626ba7e, "64 bytes");
        (v, r, s) = vm.sign(0xBAD, digest);
        ok(ops.isValidSignature(digest, abi.encodePacked(r, s, v)) == 0xffffffff, "stranger");
        ok(ops.isValidSignature(digest, hex"00") == 0xffffffff, "malformed");
    }
}
