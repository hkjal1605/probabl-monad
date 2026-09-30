// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DeltaVault } from "../../src/vault/DeltaVault.sol";
import { DeltaVaultAdmin } from "../../src/vault/DeltaVaultAdmin.sol";
import { DeltaVaultBase } from "../../src/vault/DeltaVaultBase.sol";
import { IConditionalStocks } from "../../src/vault/interfaces/IConditionalStocks.sol";
import { MockFeed, VaultBase } from "./VaultBase.t.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/// @dev The keeper's quoting path and every limit the vault enforces on it.
contract DeltaVaultKeeperTest is VaultBase {
    function _order(O memory o) internal view returns (DeltaVaultBase.Placement memory) {
        return DeltaVaultBase.Placement(pack(o), plan(seqOf(o.market, o.branch), now_() + 60, 0));
    }

    function _o(uint8 branch, bool sell, uint64 ticks, uint256 qty)
        internal
        view
        returns (O memory)
    {
        return O(market, branch, sell, false, false, 50, uint40(now_() + 5 minutes), ticks, qty);
    }

    function _expectQuoteRevert(DeltaVaultBase.Placement memory p, bytes4 error) internal {
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](1);
        places[0] = p;
        vm.expectRevert(error);
        vm.prank(keeper);
        ops.update(market, new uint256[](0), places);
    }

    function _remaining(uint256 key) internal view returns (uint256) {
        (IConditionalStocks.Order memory o,) = IConditionalStocks(address(cs)).order(key);
        return o.remaining;
    }

    // ------------------------------------------------------------ quoting

    function testQuotesBothBranchesAndCountsTheirEscrow() public {
        uint256[4] memory before = worlds(ops.holdings());
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](4);
        places[0] = vo(YES, false, false, 10_200, 20 * NVDA);
        places[1] = vo(YES, true, false, 10_400, 20 * NVDA);
        places[2] = vo(NO, false, false, 9700, 30 * NVDA);
        places[3] = vo(NO, true, false, 9900, 30 * NVDA);
        uint256[] memory keys = quote(places);
        eq(ops.orders(market).length, 4, "tracked");
        for (uint256 i; i < 4; ++i) {
            (IConditionalStocks.Order memory o,) = IConditionalStocks(address(cs)).order(keys[i]);
            ok(o.owner == address(vault), "the vault owns its quotes");
        }
        uint256[4] memory after_ = worlds(ops.holdings());
        for (uint256 i; i < 4; ++i) {
            eq(after_[i], before[i], "escrow still counted");
        }
        DeltaVaultBase.Exposure memory e = ops.exposure(market);
        eq(uint256(e.imbalance), 0, "flat");
        eq(uint256(e.high), 50 * NVDA, "YES bids + NO asks");
        eq(uint256(-e.low), 50 * NVDA, "YES asks + NO bids");
        eq(e.resting, 2040e6 + 2080e6 + 2910e6 + 2970e6, "resting notional");
        ok(!e.crossed, "not crossed");
    }

    function testOnlyTheKeeperQuotes() public {
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](1);
        places[0] = vo(YES, false, false, 10_000, NVDA);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, vault.KEEPER_ROLE()
            )
        );
        vm.prank(alice);
        ops.update(market, new uint256[](0), places);
    }

    function testRejectsForeignMarketsAndImmediateOrders() public {
        uint32 other = createMarket(uint40(T0 - 1), uint40(T0 + 30 days));
        O memory o = _o(YES, false, 10_000, NVDA);
        o.market = other;
        _expectQuoteRevert(_order(o), DeltaVaultBase.OrderMarket.selector);

        o = _o(YES, false, 10_000, NVDA);
        o.ioc = true;
        _expectQuoteRevert(_order(o), DeltaVaultBase.OrderFlags.selector);

        uint256[] memory cancels = new uint256[](1);
        cancels[0] = key(other, YES, 0);
        vm.expectRevert(DeltaVaultBase.OrderMarket.selector);
        vm.prank(keeper);
        ops.update(market, cancels, new DeltaVaultBase.Placement[](0));

        vm.expectRevert(DeltaVaultBase.UnknownMarket.selector);
        vm.prank(keeper);
        ops.update(other, new uint256[](0), new DeltaVaultBase.Placement[](0));
    }

    function testRejectsFeesAboveTheVaultCap() public {
        O memory o = _o(YES, false, 10_000, NVDA);
        o.maxFee = 101;
        _expectQuoteRevert(_order(o), DeltaVaultBase.OrderFee.selector);
        o.maxFee = 100;
        quote1(_order(o));
    }

    function testRejectsLifetimesPastTheTtlOrTheCutoffBuffer() public {
        O memory o = _o(YES, false, 10_000, NVDA);
        o.expiry = uint40(now_() + 10 minutes + 1);
        _expectQuoteRevert(_order(o), DeltaVaultBase.OrderExpiry.selector);
        o.expiry = uint40(now_() + 10 minutes);
        quote1(_order(o));

        // Inside the last hour before the cutoff nothing can be posted.
        vm.warp(T0 + 30 days - 1 hours - 60);
        feed.set(100e8, now_(), now_());
        o = _o(YES, false, 10_000, NVDA);
        o.expiry = uint40(now_() + 61);
        _expectQuoteRevert(_order(o), DeltaVaultBase.OrderExpiry.selector);
        o.expiry = uint40(now_() + 60);
        quote1(_order(o));
    }

    function testPricesStayWithinTheBandAroundTheOracle() public {
        // A 10% band around $100: $90 and $110 inclusive.
        _expectQuoteRevert(vo(YES, false, false, 8999, NVDA), DeltaVaultBase.OrderPrice.selector);
        _expectQuoteRevert(vo(YES, true, false, 11_001, NVDA), DeltaVaultBase.OrderPrice.selector);
        quote1(vo(YES, false, false, 9000, NVDA));
        quote1(vo(NO, true, false, 11_000, NVDA));
        // The band follows the oracle.
        feed.set(120e8, now_(), now_());
        _expectQuoteRevert(vo(NO, true, false, 10_700, NVDA), DeltaVaultBase.OrderPrice.selector);
        quote1(vo(NO, true, false, 10_800, NVDA));
    }

    function testFuzzBand(uint256 price, uint64 ticks) public {
        price = 50e8 + price % 150e8;
        ticks = uint64(4000 + ticks % 26_000);
        feed.set(int256(price), now_(), now_());
        uint256 spot = price / 100; // Exchange units: 8 feed decimals -> 6 quote decimals.
        uint256 band = spot * 1000 / 10_000;
        uint256 limit = uint256(ticks) * TICK;
        bool inBand = limit + band >= spot && limit <= spot + band;
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](1);
        places[0] = vo(YES, false, false, ticks, NVDA);
        vm.prank(keeper);
        try ops.update(market, new uint256[](0), places) {
            ok(inBand, "accepted outside the band");
        } catch (bytes memory reason) {
            ok(!inBand && bytes4(reason) == DeltaVaultBase.OrderPrice.selector, "rejected in band");
        }
    }

    function testRejectsOversizedOrdersAndRestingNotional() public {
        _expectQuoteRevert(
            vo(YES, false, false, 10_000, 501 * NVDA), DeltaVaultBase.OrderSize.selector
        );
        DeltaVaultBase.Risk memory r = risk();
        r.maxOrder = 30_000e6;
        r.maxResting = 30_000e6;
        vm.prank(curator);
        ops.setRisk(market, r);
        quote1(vo(YES, false, false, 10_000, 200 * NVDA));
        _expectQuoteRevert(
            vo(NO, false, false, 10_000, 101 * NVDA), DeltaVaultBase.RestingCap.selector
        );
        quote1(vo(NO, false, false, 10_000, 100 * NVDA));
    }

    function testOracleAndSequencerFailuresStopQuotingButNotCancels() public {
        uint256 k = quote1(vo(YES, false, false, 10_000, NVDA));
        vm.warp(now_() + 1 days + 1 hours + 1);
        _expectQuoteRevert(vo(YES, false, false, 10_000, NVDA), DeltaVaultBase.StaleOracle.selector);
        feed.set(0, now_(), now_());
        _expectQuoteRevert(vo(YES, false, false, 10_000, NVDA), DeltaVaultBase.StaleOracle.selector);
        feed.set(100e8, now_(), now_() + 1);
        _expectQuoteRevert(vo(YES, false, false, 10_000, NVDA), DeltaVaultBase.StaleOracle.selector);
        cancel1(k);
        eq(_remaining(k), 0, "cancelled without an oracle");
    }

    function testSequencerFeed() public {
        MockFeed up = new MockFeed(0);
        DeltaVault v = new DeltaVault(config(address(up)));
        DeltaVaultAdmin a = DeltaVaultAdmin(address(v));
        vm.startPrank(vaultAdmin);
        v.grantRole(v.KEEPER_ROLE(), keeper);
        v.grantRole(v.CURATOR_ROLE(), curator);
        a.setCaps(type(uint128).max, type(uint128).max);
        vm.stopPrank();
        vm.startPrank(curator);
        a.setLimits(DeltaVaultBase.Limits(10 minutes, 1 days, 100));
        a.addMarket(market, risk());
        vm.stopPrank();
        give(vaultAdmin, 10_000e6, 100 * NVDA);
        vm.startPrank(vaultAdmin);
        usdc.approve(address(v), type(uint256).max);
        stock.approve(address(v), type(uint256).max);
        v.deposit(10_000e6, 100 * NVDA, 0, vaultAdmin);
        vm.stopPrank();

        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](1);
        places[0] = vo(YES, false, false, 10_000, NVDA);
        up.set(1, now_() - 2 hours, now_());
        vm.expectRevert(DeltaVaultBase.SequencerDown.selector);
        vm.prank(keeper);
        a.update(market, new uint256[](0), places);
        // Back up, but within the grace period.
        up.set(0, now_() - 30 minutes, now_());
        vm.expectRevert(DeltaVaultBase.SequencerDown.selector);
        vm.prank(keeper);
        a.update(market, new uint256[](0), places);
        up.set(0, now_() - 2 hours, now_());
        vm.prank(keeper);
        a.update(market, new uint256[](0), places);
    }

    // ------------------------------------------------------------ exposure

    function testWorstCaseImbalanceCap() public {
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](2);
        places[0] = vo(YES, false, false, 10_000, 150 * NVDA);
        places[1] = vo(NO, true, false, 10_000, 51 * NVDA);
        vm.expectRevert(DeltaVaultBase.ImbalanceCap.selector);
        vm.prank(keeper);
        ops.update(market, new uint256[](0), places);
        places[1] = vo(NO, true, false, 10_000, 50 * NVDA);
        uint256[] memory keys = quote(places);

        // Fill the YES bid, then cut the cap below the position: only reductions pass.
        fill(bob, keys[0], 150 * NVDA);
        cancel1(keys[1]);
        eq(uint256(ops.exposure(market).imbalance), 150 * NVDA, "long YES");
        DeltaVaultBase.Risk memory r = risk();
        r.maxImbalance = uint96(100 * NVDA);
        vm.prank(curator);
        ops.setRisk(market, r);
        _expectQuoteRevert(
            vo(YES, false, false, 10_000, NVDA), DeltaVaultBase.ImbalanceCap.selector
        );
        _expectQuoteRevert(vo(NO, true, false, 10_000, NVDA), DeltaVaultBase.ImbalanceCap.selector);
        quote1(vo(YES, true, false, 10_100, 60 * NVDA));
        quote1(vo(NO, false, false, 9900, 40 * NVDA));
        DeltaVaultBase.Exposure memory e = ops.exposure(market);
        eq(uint256(e.high), 150 * NVDA, "no growth");
        eq(uint256(e.low), 50 * NVDA, "reductions");
    }

    function testRejectsCrossedVaultQuotes() public {
        quote1(vo(YES, true, false, 10_100, NVDA));
        // A later plan does not see the older ask, so only the vault's own check stops this.
        _expectQuoteRevert(
            vo(YES, false, false, 10_100, NVDA), DeltaVaultBase.CrossedQuotes.selector
        );
        quote1(vo(YES, false, false, 10_099, NVDA));
        // The other branch is an independent book.
        quote1(vo(NO, false, false, 10_100, NVDA));
    }

    function testOrderCountLimitAndPruning() public {
        // Sixteen placements per branch and call keep within the exchange's race window.
        for (uint256 round; round < 3; ++round) {
            DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](16);
            for (uint256 i; i < 16; ++i) {
                uint64 ticks = uint64(10_500 + round * 100 + i);
                places[i] = vo(uint8(i % 2), true, false, ticks, 20 * STEP);
            }
            quote(places);
        }
        eq(ops.orders(market).length, 48, "at the limit");
        _expectQuoteRevert(
            vo(YES, true, false, 10_900, 20 * STEP), DeltaVaultBase.OrderLimit.selector
        );

        // A fully filled order is forgotten on the next update.
        uint256 first = ops.orders(market)[0];
        fill(alice, first, 20 * STEP);
        vm.prank(keeper);
        ops.update(market, new uint256[](0), new DeltaVaultBase.Placement[](0));
        eq(ops.orders(market).length, 47, "pruned");
        quote1(vo(YES, true, false, 10_900, 20 * STEP));
    }

    function testStaleEntriesOfOtherMarketsNeverBlockQuoting() public {
        uint32 other = createMarket(uint40(T0 - 1), uint40(T0 + 30 days));
        vm.prank(marketAdmin);
        view_.lifecycle(other, 0, bytes32(0));
        vm.prank(curator);
        ops.addMarket(other, risk());
        // 40 asks in the other market, then all filled: they stay tracked there until pruned.
        uint256[] memory posted = new uint256[](40);
        for (uint256 round; round < 5; ++round) {
            DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](8);
            for (uint256 i; i < 8; ++i) {
                O memory ask = O(
                    other,
                    YES,
                    true,
                    false,
                    false,
                    50,
                    uint40(now_() + 5 minutes),
                    uint64(10_500 + round * 10 + i),
                    20 * STEP
                );
                places[i] =
                    DeltaVaultBase.Placement(pack(ask), plan(seqOf(other, YES), now_() + 60, 0));
            }
            vm.prank(keeper);
            uint256[] memory keys = ops.update(other, new uint256[](0), places);
            for (uint256 i; i < 8; ++i) {
                posted[round * 8 + i] = keys[i];
            }
        }
        for (uint256 i; i < 40; ++i) {
            (IConditionalStocks.Order memory o,) = IConditionalStocks(address(cs)).order(posted[i]);
            O memory buy =
                O(other, YES, false, false, true, 1000, uint40(T0 + 10 days), o.ticks, 20 * STEP);
            uint256 taken = plan(seqOf(other, YES), now_() + 60, 0);
            vm.prank(alice);
            cs.place(pack(buy), taken, one(uint32(posted[i])));
        }
        eq(ops.orders(other).length, 40, "dead entries tracked");
        // Nine live quotes here would pass the limit counting them; the vault prunes and posts.
        DeltaVaultBase.Placement[] memory more = new DeltaVaultBase.Placement[](9);
        for (uint256 i; i < 9; ++i) {
            more[i] = vo(uint8(i % 2), true, false, uint64(10_600 + i), 20 * STEP);
        }
        quote(more);
        eq(ops.orders(other).length, 0, "pruned");
        eq(ops.orders(market).length, 9, "posted");
    }

    function testClaimFundedQuotesCountAsHoldingsAndExposure() public {
        // Buy 3 NVDA-if-YES, then offer them back claim-funded.
        uint256 bid = quote1(vo(YES, false, false, 9900, 3 * NVDA));
        fill(bob, bid, 3 * NVDA);
        uint256[4] memory before = worlds(ops.holdings());
        uint256 ask = quote1(vo(YES, true, true, 10_100, 3 * NVDA));
        eq(acct(address(vault), YES).base, 0, "claims escrowed");
        uint256[4] memory after_ = worlds(ops.holdings());
        for (uint256 i; i < 4; ++i) {
            eq(after_[i], before[i], "escrow still counted");
        }
        DeltaVaultBase.Exposure memory e = ops.exposure(market);
        eq(uint256(e.imbalance), 3 * NVDA, "escrowed claims still held");
        eq(uint256(e.low), 0, "the ask can flatten it");
        fill(alice, ask, 3 * NVDA);
        eq(uint256(ops.exposure(market).imbalance), 0, "flat");
    }

    // ------------------------------------------------------------ keeper upkeep and emergencies

    function testPauseInvalidatesQuotesAndBlocksNewOnes() public {
        uint256 ask = quote1(vo(YES, true, false, 10_100, 5 * NVDA));
        vm.prank(sentinel);
        ops.pause();
        // A taker naming the invalidated maker fills nothing.
        uint256 before = acct(alice, YES).base;
        fill(alice, ask, 5 * NVDA);
        eq(acct(alice, YES).base, before, "unfillable");
        eq(_remaining(ask), 5 * NVDA, "escrow intact");
        _expectQuoteRevert(vo(YES, true, false, 10_100, NVDA), Pausable.EnforcedPause.selector);
        give(alice, 1000e6, 10 * NVDA);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(alice);
        vault.deposit(1000e6, 10 * NVDA, 0, alice);
        // Cancels still work, and anyone may release an invalidated order.
        vm.prank(carol);
        cs.cancel(ask);
        eq(_remaining(ask), 0, "released");

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, sentinel, bytes32(0)
            )
        );
        vm.prank(sentinel);
        ops.unpause();
        vm.prank(vaultAdmin);
        ops.unpause();
        quote1(vo(YES, true, false, 10_100, NVDA));
    }

    function testMergeAndCancelAll() public {
        // Selling YES and NO stock whole-funded leaves paired stock claims.
        DeltaVaultBase.Placement[] memory places = new DeltaVaultBase.Placement[](2);
        places[0] = vo(YES, true, false, 10_300, 4 * NVDA);
        places[1] = vo(NO, true, false, 9900, 4 * NVDA);
        uint256[] memory keys = quote(places);
        fill(alice, keys[0], 4 * NVDA);
        fill(bob, keys[1], 4 * NVDA);
        eq(acct(address(vault), YES).base, 4 * NVDA, "stock if YES");
        eq(acct(address(vault), NO).base, 4 * NVDA, "stock if NO");
        uint256[4] memory before = worlds(ops.holdings());
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, vault.KEEPER_ROLE()
            )
        );
        vm.prank(alice);
        ops.merge(market);
        vm.prank(keeper);
        ops.merge(market);
        eq(acct(address(vault), YES).base + acct(address(vault), NO).base, 0, "merged");
        uint256[4] memory after_ = worlds(ops.holdings());
        for (uint256 i; i < 4; ++i) {
            eq(after_[i], before[i], "merging changes no world");
        }

        quote(places);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                vault.GUARDIAN_ROLE()
            )
        );
        vm.prank(alice);
        ops.cancelAll();
        vm.prank(sentinel);
        ops.cancelAll();
        eq(ops.orders(market).length, 0, "all cancelled");
    }
}
