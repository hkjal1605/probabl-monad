// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base, MockToken } from "./Base.t.sol";

contract TradingTest is Base {
    uint256 internal constant NVDA = 1e18;

    function _split(address user, uint8 collateral, uint256 amount) internal {
        vm.prank(user);
        cs.split(market, collateral, amount);
    }

    function testDepositWithdraw() public {
        eq(credit(alice, address(usdc)), 1_000_000e6, "credit");
        eq(view_.pool(address(usdc)).liability, 4_000_000e6, "liability");
        vm.prank(alice);
        cs.withdraw(address(usdc), 100e6, carol);
        eq(usdc.balanceOf(carol), 100e6, "received");
        eq(credit(alice, address(usdc)), 999_900e6, "debited");
        vm.expectRevert(ConditionalStocksBase.InsufficientFunds.selector);
        vm.prank(alice);
        cs.withdraw(address(usdc), 2_000_000e6, alice);
    }

    function testDepositCreditsNetOfTransferFeeAndAcceptsNoReturnTokens() public {
        MockToken fee = new MockToken("FEE", 6);
        fee.setFee(100);
        fee.setNoReturn(true);
        vm.prank(marketAdmin);
        view_.listPool(address(fee));
        fee.mint(alice, 1_000e6);
        vm.startPrank(alice);
        fee.approve(address(cs), type(uint256).max);
        cs.deposit(address(fee), 1_000e6);
        eq(credit(alice, address(fee)), 990e6, "net credit");
        cs.withdraw(address(fee), 990e6, alice);
        vm.stopPrank();
        eq(view_.pool(address(fee)).liability, 0, "liability");
    }

    function testSplitMergeConserveBacking() public {
        _split(bob, 1, 10 * NVDA);
        eq(acct(bob, YES).base, 10 * NVDA, "yes");
        eq(acct(bob, NO).base, 10 * NVDA, "no");
        eq(view_.backing(market).base, 10 * NVDA, "backing");
        vm.prank(bob);
        cs.merge(market, 1, 4 * NVDA);
        eq(view_.backing(market).base, 6 * NVDA, "backing after merge");
        eq(credit(bob, address(stock)), 10_000e18 - 6 * NVDA, "credit");
    }

    function testClaimFundedAskFilledByWholeFundedBuyer() public {
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, 5 * NVDA);
        eq(acct(bob, YES).base, 5 * NVDA, "escrowed");
        eq(acct(bob, YES).notional, 1_000e6, "maker notional");

        uint256 usdcBefore = credit(alice, address(usdc));
        take(alice, YES, false, false, 20_100, 2 * NVDA, one(uint32(ask)));

        eq(credit(alice, address(usdc)), usdcBefore - 400e6, "buyer paid the ask");
        eq(acct(alice, YES).base, 2 * NVDA, "buyer receives stock-if-YES");
        eq(acct(alice, NO).quote, 400e6, "buyer keeps quote-if-NO");
        eq(acct(bob, YES).quote, 400e6, "seller receives quote-if-YES");
        eq(acct(bob, YES).notional, 600e6, "maker notional reduced");
        eq(view_.backing(market).quote, 400e6, "quote backing");
        (ConditionalStocksBase.Order memory o,) = view_.order(ask);
        eq(o.remaining, 3 * NVDA, "maker remaining");
        eq(view_.book(market).openNotional, 600e6, "market notional");
    }

    function testWholeFundedBidFilledByWholeFundedSellerWithFees() public {
        vm.prank(admin);
        view_.configure(marketAdmin, guardian, resolver, 10, 20);
        uint256 bid = rest(carol, NO, false, false, 15_000, 3 * NVDA);
        eq(credit(carol, address(usdc)), 1_000_000e6 - 450e6, "bid escrow");

        take(bob, NO, true, false, 14_000, NVDA, one(uint32(bid)));

        eq(acct(carol, NO).base, NVDA - 1e15, "buyer receives net stock-if-NO");
        eq(acct(carol, YES).quote, 150e6, "buyer keeps quote-if-YES");
        eq(acct(bob, NO).quote, 150e6 - 3e5, "seller receives net quote-if-NO");
        eq(acct(bob, YES).base, NVDA, "seller keeps stock-if-YES");
        eq(credit(bob, address(stock)), 10_000e18 - NVDA, "seller delivered stock");
        ConditionalStocksBase.Fees memory f = view_.fees(market, NO);
        eq(f.base, 1e15, "maker fee");
        eq(f.quote, 3e5, "taker fee");
        eq(view_.backing(market).quote, 150e6, "quote backing");
        eq(view_.backing(market).base, NVDA, "base backing");
    }

    function testExactStepPricesLeaveNoImprovement() public {
        uint256 bid = rest(carol, YES, false, false, 15_000, 3 * NVDA);
        uint256 creditBefore = credit(carol, address(usdc));
        take(bob, YES, true, false, 15_000, 1e16, one(uint32(bid)));
        // quote = 1e16 * 1.5e8 / 1e18 = 1.5e6 exactly: no rounding improvement.
        eq(credit(carol, address(usdc)), creditBefore, "no improvement");
        eq(acct(carol, NO).quote, 1_500_000, "buyer keeps quote-if-NO");
        eq(acct(carol, YES).base, 1e16, "stock-if-YES");
    }

    function testGtcRemainderRestsAndCancelRefunds() public {
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        uint256 seq = seqOf(market, YES);
        O memory o =
            O(market, YES, false, false, false, 1_000, uint40(T0 + 1 days), 20_000, 3 * NVDA);
        vm.prank(alice);
        uint256 k = cs.place(pack(o), plan(seq, now_() + 60, 0), one(uint32(ask)));
        (ConditionalStocksBase.Order memory resting,) = view_.order(k);
        eq(resting.remaining, 2 * NVDA, "remainder rests");
        eq(acct(alice, YES).notional, 400e6, "remainder notional");
        eq(credit(alice, address(usdc)), 1_000_000e6 - 200e6 - 400e6, "paid fill and escrow");
        (ConditionalStocksBase.Order memory filled,) = view_.order(ask);
        eq(filled.remaining, 0, "filled maker deleted");

        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(bob);
        cs.cancel(k);
        vm.prank(alice);
        cs.cancel(k);
        eq(credit(alice, address(usdc)), 1_000_000e6 - 200e6, "escrow refunded");
        eq(acct(alice, YES).notional, 0, "notional released");
        eq(view_.book(market).openNotional, 0, "market notional released");
    }

    function testReplaceRequotesWithReleasedReservation() public {
        _split(bob, 1, 2 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, 2 * NVDA);
        eq(acct(bob, YES).base, 0, "fully escrowed");
        O memory o = O(market, YES, true, true, false, 0, uint40(T0 + 1 days), 21_000, 2 * NVDA);
        uint256 packed = pack(o);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);

        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(alice);
        cs.replace(ask, packed, p, 0);

        vm.prank(bob);
        uint256 k = cs.replace(ask, packed, p, 0);
        (ConditionalStocksBase.Order memory old,) = view_.order(ask);
        (ConditionalStocksBase.Order memory next,) = view_.order(k);
        eq(old.remaining, 0, "old order closed");
        eq(next.ticks, 21_000, "requoted");
        eq(acct(bob, YES).base, 0, "released claims fund the new order");
        eq(acct(bob, YES).notional, 420e6, "notional replaced");

        p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.expectRevert(ConditionalStocksBase.InvalidOrder.selector);
        vm.prank(bob);
        cs.replace(ask, packed, p, 0);
    }

    function testMultipleMakersBestFirstAndSkipsClosedMaker() public {
        _split(bob, 1, 10 * NVDA);
        _split(carol, 1, 10 * NVDA);
        uint256 a1 = rest(bob, YES, true, true, 20_000, NVDA);
        uint256 a2 = rest(carol, YES, true, true, 20_100, NVDA);
        uint256 a3 = rest(bob, YES, true, true, 20_200, NVDA);
        vm.prank(bob);
        cs.cancel(a1); // Closed after planning: skipped.
        uint256[] memory seqs = new uint256[](3);
        seqs[0] = uint32(a1);
        seqs[1] = uint32(a2);
        seqs[2] = uint32(a3);
        take(alice, YES, false, false, 20_200, 2 * NVDA, makers(seqs));
        eq(acct(alice, YES).base, 2 * NVDA, "filled two");
        eq(acct(carol, YES).quote, 201e6, "carol at 201");
        eq(acct(bob, YES).quote, 202e6, "bob at 202");
    }

    function testIocWithMinFillRevertsWhenBookMoved() public {
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        vm.prank(bob);
        cs.cancel(ask);
        O memory o = O(market, YES, false, false, true, 1_000, uint40(T0 + 1 days), 20_000, NVDA);
        uint256 seq = seqOf(market, YES);
        vm.expectRevert(ConditionalStocksBase.StalePlan.selector);
        vm.prank(alice);
        cs.place(pack(o), plan(seq, now_() + 60, STEP), one(uint32(ask)));
    }

    function testRestingOrderCannotCrossOrderPlacedAfterItsPlan() public {
        _split(bob, 1, 10 * NVDA);
        uint256 planned = seqOf(market, YES);
        rest(bob, YES, true, true, 20_000, NVDA); // Ask placed after alice planned.
        O memory o = O(market, YES, false, false, false, 1_000, uint40(T0 + 1 days), 20_100, NVDA);
        vm.expectRevert(ConditionalStocksBase.StalePlan.selector);
        vm.prank(alice);
        cs.place(pack(o), plan(planned, now_() + 60, 0), 0);
        // A non-crossing bid planned against the same stale book still rests.
        o.ticks = 19_900;
        vm.prank(alice);
        cs.place(pack(o), plan(planned, now_() + 60, 0), 0);
    }

    function testPlanFromFutureOrWithNewerMakerIsStale() public {
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        O memory o = O(market, YES, false, false, true, 1_000, uint40(T0 + 1 days), 20_000, NVDA);
        uint256 seq = seqOf(market, YES);
        vm.expectRevert(ConditionalStocksBase.StalePlan.selector);
        vm.prank(alice);
        cs.place(pack(o), plan(seq + 1, now_() + 60, 0), 0);
        vm.expectRevert(ConditionalStocksBase.StalePlan.selector);
        vm.prank(alice);
        cs.place(pack(o), plan(uint32(ask), now_() + 60, 0), one(uint32(ask)));
    }

    function testUncrossedOrSameSideMakerRejectsPlan() public {
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        O memory o = O(market, YES, false, false, true, 1_000, uint40(T0 + 1 days), 19_000, NVDA);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.expectRevert(ConditionalStocksBase.StalePlan.selector);
        vm.prank(alice);
        cs.place(pack(o), p, one(uint32(ask)));
        o.sell = true;
        vm.expectRevert(ConditionalStocksBase.StalePlan.selector);
        vm.prank(carol);
        cs.place(pack(o), p, one(uint32(ask)));
    }

    function testFeeCapsSkipMakerAndRejectTaker() public {
        _split(bob, 1, 10 * NVDA);
        O memory lowCap = O(market, YES, true, true, false, 5, uint40(T0 + 1 days), 20_000, NVDA);
        uint256 seq = seqOf(market, YES);
        vm.prank(bob);
        uint256 ask = cs.place(pack(lowCap), plan(seq, now_() + 60, 0), 0);
        vm.prank(admin);
        view_.configure(marketAdmin, guardian, resolver, 10, 20);
        take(alice, YES, false, false, 20_000, NVDA, one(uint32(ask)));
        eq(acct(alice, YES).base, 0, "maker priced out of its cap is skipped");

        uint256 ask2 = rest(bob, YES, true, true, 20_000, NVDA);
        O memory taker = O(market, YES, false, false, true, 10, uint40(T0 + 1 days), 20_000, NVDA);
        seq = seqOf(market, YES);
        vm.expectRevert(ConditionalStocksBase.FeeCap.selector);
        vm.prank(alice);
        cs.place(pack(taker), plan(seq, now_() + 60, 0), one(uint32(ask2)));
    }

    function testInvalidatedOrdersAreSkippedAndPubliclyReleasable() public {
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        vm.prank(bob);
        view_.invalidateOrders();
        take(alice, YES, false, false, 20_000, NVDA, one(uint32(ask)));
        eq(acct(alice, YES).base, 0, "skipped");
        vm.prank(carol);
        cs.cancel(ask);
        eq(acct(bob, YES).base, 10 * NVDA, "released to owner");
    }

    function testExpiredAndClosedMarketOrdersArePubliclyReleasable() public {
        uint256 bid = rest(carol, YES, false, false, 15_000, NVDA);
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(alice);
        cs.cancel(bid);
        vm.prank(guardian);
        view_.lifecycle(market, 1, keccak256("halt"));
        vm.prank(alice);
        cs.cancel(bid);
        eq(credit(carol, address(usdc)), 1_000_000e6, "refunded");
        vm.expectRevert(ConditionalStocksBase.InvalidOrder.selector);
        cs.cancel(bid);
    }

    function testCancelManySkipsClosedEntries() public {
        uint256 a = rest(carol, YES, false, false, 15_000, NVDA);
        uint256 b = rest(carol, NO, false, false, 15_000, NVDA);
        vm.prank(carol);
        cs.cancel(a);
        uint256[] memory keys = new uint256[](2);
        keys[0] = a;
        keys[1] = b;
        vm.prank(carol);
        cs.cancelMany(keys);
        eq(credit(carol, address(usdc)), 1_000_000e6, "all refunded");
    }

    function testRiskCaps() public {
        uint32 small;
        {
            ConditionalStocksBase.MarketParams memory p = params(uint40(T0), uint40(T0 + 1 days));
            p.maxOrder = 1_000e6;
            p.maxWallet = 1_500e6;
            p.maxMarket = 2_000e6;
            p.metadataHash = keccak256(bytes("ipfs://small"));
            vm.prank(marketAdmin);
            small = view_.createMarket(p, "ipfs://small");
        }
        vm.prank(marketAdmin);
        view_.lifecycle(small, 0, bytes32(0));
        O memory o =
            O(small, YES, false, false, false, 1_000, uint40(T0 + 1 hours), 10_000, 10 * NVDA);
        vm.prank(alice);
        cs.place(pack(o), plan(0, now_() + 60, 0), 0); // $1000 notional.
        o.branch = NO;
        o.quantity = 6 * NVDA;
        vm.expectRevert(ConditionalStocksBase.CapExceeded.selector);
        vm.prank(alice);
        cs.place(pack(o), plan(0, now_() + 60, 0), 0); // Wallet $1600 > $1500.
        o.quantity = 5 * NVDA;
        vm.prank(alice);
        cs.place(pack(o), plan(0, now_() + 60, 0), 0);
        o.quantity = 6 * NVDA;
        vm.expectRevert(ConditionalStocksBase.CapExceeded.selector);
        vm.prank(bob);
        cs.place(pack(o), plan(1, now_() + 60, 0), 0); // Market $2100 > $2000.
    }

    function testOrderValidation() public {
        O memory o = O(market, YES, false, false, false, 1_000, uint40(T0 + 1 days), 20_000, NVDA);
        uint256 p = plan(0, now_() + 60, 0);
        o.quantity = NVDA + 1;
        vm.expectRevert(ConditionalStocksBase.InvalidOrder.selector);
        vm.prank(alice);
        cs.place(pack(o), p, 0);
        o.quantity = NVDA;
        o.maxFee = 1_001;
        vm.expectRevert(ConditionalStocksBase.InvalidOrder.selector);
        vm.prank(alice);
        cs.place(pack(o), p, 0);
        o.maxFee = 0;
        o.expiry = uint40(T0 + 31 days);
        vm.expectRevert(ConditionalStocksBase.Expired.selector);
        vm.prank(alice);
        cs.place(pack(o), p, 0);
        o.expiry = uint40(T0 + 1 days);
        vm.expectRevert(ConditionalStocksBase.StalePlan.selector);
        vm.prank(alice);
        cs.place(pack(o), plan(0, now_(), 0), 0);
        o.ticks = 1; // $0.00000001 x 1 token: below the minimum notional.
        vm.expectRevert(ConditionalStocksBase.CapExceeded.selector);
        vm.prank(alice);
        cs.place(pack(o), p, 0);
    }

    function testPauseBlocksPlacementButNotCancellation() public {
        uint256 bid = rest(carol, YES, false, false, 15_000, NVDA);
        vm.prank(guardian);
        view_.pause(true, keccak256("incident"));
        O memory o = O(market, YES, false, false, false, 1_000, uint40(T0 + 1 days), 15_000, NVDA);
        vm.expectRevert(ConditionalStocksBase.NotTrading.selector);
        vm.prank(alice);
        cs.place(pack(o), plan(1, now_() + 60, 0), 0);
        vm.prank(carol);
        cs.cancel(bid);
    }

    function testSelfMatchKeepsLedgerConsistent() public {
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        // The maker leg's quote proceeds fund the taker leg's claim payment: net neutral.
        take(bob, YES, false, true, 20_000, NVDA, one(uint32(ask)));
        eq(acct(bob, YES).base, 10 * NVDA, "stock claims restored");
        eq(acct(bob, YES).quote, 0, "quote claims net to zero");
    }

    function testSelfMatchWithClaimFundingIsNeutral() public {
        _split(bob, 1, 10 * NVDA);
        _split(bob, 0, 1_000e6);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        take(bob, YES, false, true, 20_000, NVDA, one(uint32(ask)));
        eq(acct(bob, YES).base, 10 * NVDA, "stock");
        eq(acct(bob, YES).quote, 1_000e6, "quote");
        eq(acct(bob, YES).notional, 0, "notional");
    }
}
