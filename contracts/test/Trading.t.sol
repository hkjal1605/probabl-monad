// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base, MockToken, Vm } from "./Base.t.sol";

interface VmAccesses {
    function record() external;
    function accesses(address target)
        external
        returns (bytes32[] memory readSlots, bytes32[] memory writeSlots);
}

contract TradingTest is Base {
    VmAccesses internal constant vma =
        VmAccesses(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant NVDA = 1e18;
    /// Storage slot of `_feeRates`, from `forge inspect ConditionalStocks storageLayout`.
    uint256 internal constant FEE_RATES_SLOT = 25;
    bytes32 internal constant TRADE_EVENT = keccak256("Trade(uint32,uint256,uint256,uint256)");

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
        view_.listPool(address(fee), bytes32("US:FEE"));
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
        eq(view_.book(market).openNotional, 0, "asks do not use the market cap");
    }

    function testWholeFundedBidFilledByWholeFundedSellerWithFees() public {
        useFees(10, 20);
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

    /// @dev The same trade in two markets: each charges its own maker and taker rates and
    ///      accrues them in its own fee pools.
    function testEachMarketChargesItsOwnFeeRates() public {
        uint32 free = market;
        useFees(10, 20);
        uint32 low = market;
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        take(alice, YES, false, false, 20_000, NVDA, one(uint32(ask)));
        useFees(250, 5);
        uint32 high = market;
        _split(bob, 1, 10 * NVDA);
        ask = rest(bob, YES, true, true, 20_000, NVDA);
        take(alice, YES, false, false, 20_000, NVDA, one(uint32(ask)));

        ConditionalStocksBase.FeeRates memory r = view_.feeRates(low);
        eq(r.makerBps, 10, "low maker rate");
        eq(r.takerBps, 20, "low taker rate");
        r = view_.feeRates(high);
        eq(r.makerBps, 250, "high maker rate");
        eq(r.takerBps, 5, "high taker rate");
        r = view_.feeRates(free);
        eq(uint256(r.makerBps) + r.takerBps, 0, "default market is fee-free");

        // The taker (buyer) pays in stock-if-YES, the maker (seller) in quote-if-YES.
        ConditionalStocksBase.Fees memory f = view_.fees(low, YES);
        eq(f.base, NVDA * 20 / 10_000, "low taker fee");
        eq(f.quote, 200e6 * 10 / 10_000, "low maker fee");
        eq(view_.account(low, YES, alice).base, NVDA - NVDA * 20 / 10_000, "low net stock");
        eq(view_.account(low, YES, bob).quote, 200e6 - 200e6 * 10 / 10_000, "low net quote");
        f = view_.fees(high, YES);
        eq(f.base, NVDA * 5 / 10_000, "high taker fee");
        eq(f.quote, 200e6 * 250 / 10_000, "high maker fee");
        eq(view_.account(high, YES, alice).base, NVDA - NVDA * 5 / 10_000, "high net stock");
        eq(view_.account(high, YES, bob).quote, 200e6 - 200e6 * 250 / 10_000, "high net quote");
    }

    /// @dev Resting placements and cancels (a market maker's requotes) never read the fee rates;
    ///      only a placement that fills does.
    function testOnlyFillingPlacementsReadTheFeeRates() public {
        useFees(10, 20);
        bytes32 slot = keccak256(abi.encode(uint256(market), FEE_RATES_SLOT));
        _split(bob, 1, 10 * NVDA);
        vma.record();
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        ok(!_reads(slot), "a resting placement reads no fee rates");
        vma.record();
        vm.prank(bob);
        cs.cancel(ask);
        ok(!_reads(slot), "a cancel reads no fee rates");
        ask = rest(bob, YES, true, true, 20_000, NVDA);
        vma.record();
        take(alice, YES, false, false, 20_000, NVDA, one(uint32(ask)));
        ok(_reads(slot), "a filling placement reads the fee rates");
        eq(view_.fees(market, YES).base, NVDA * 20 / 10_000, "and charges them");
    }

    function _reads(bytes32 slot) internal returns (bool) {
        (bytes32[] memory reads,) = vma.accesses(address(cs));
        for (uint256 i; i < reads.length; ++i) {
            if (reads[i] == slot) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- maker rebates

    /// @dev A taker buy: the taker pays its whole fee in the stock-if-YES it receives; the maker,
    ///      which sold that stock, gets the market's share of the fee back in it, still pays its
    ///      own maker fee, and the protocol keeps the rest.
    function testMakerRebateOnATakerBuyIsPaidInTheStockClaimsTheMakerSold() public {
        useFees(10, 30);
        useRebate(5_000);
        _split(bob, 1, 10 * NVDA);
        uint256 ask = rest(bob, YES, true, true, 20_000, NVDA);
        vm.recordLogs();
        take(alice, YES, false, false, 20_000, NVDA, one(uint32(ask)));

        uint256 takerFee = NVDA * 30 / 10_000;
        uint256 makerFee = 200e6 * 10 / 10_000;
        uint256 rebate = takerFee / 2;
        eq(acct(alice, YES).base, NVDA - takerFee, "the taker pays its whole fee");
        eq(acct(bob, YES).base, 9 * NVDA + rebate, "the maker gets half of it back");
        eq(acct(bob, YES).quote, 200e6 - makerFee, "and still pays the maker fee");
        ConditionalStocksBase.Fees memory f = view_.fees(market, YES);
        eq(f.base, takerFee - rebate, "the protocol keeps the rest of the taker fee");
        eq(f.quote, makerFee, "and the maker fee");
        eq(
            acct(alice, YES).base + acct(bob, YES).base + f.base,
            view_.backing(market).base,
            "stock-if-YES claims stay exactly backed"
        );
        // The event reports the fees as charged; the rebate follows from the market's rate.
        uint256 fees = _lastTradeFees();
        eq(uint128(fees), takerFee, "event: buyer fee");
        eq(fees >> 128, makerFee, "event: seller fee");
    }

    /// @dev A taker sell: the taker pays its fee in the quote-if-NO it receives; the maker, a
    ///      whole-funded bid that paid in quote, gets its share back in quote-if-NO.
    function testMakerRebateOnATakerSellIsPaidInTheQuoteClaimsTheMakerPaid() public {
        useFees(10, 30);
        useRebate(2_500);
        uint256 bid = rest(carol, NO, false, false, 15_000, 3 * NVDA);
        take(bob, NO, true, false, 14_000, NVDA, one(uint32(bid)));

        uint256 takerFee = 150e6 * 30 / 10_000;
        uint256 makerFee = NVDA * 10 / 10_000;
        uint256 rebate = takerFee / 4;
        eq(acct(bob, NO).quote, 150e6 - takerFee, "the taker pays its whole fee");
        eq(acct(carol, NO).quote, rebate, "the maker gets a quarter of it back");
        eq(acct(carol, NO).base, NVDA - makerFee, "and still pays the maker fee");
        eq(acct(carol, YES).quote, 150e6, "the bid keeps its quote-if-YES");
        ConditionalStocksBase.Fees memory f = view_.fees(market, NO);
        eq(f.quote, takerFee - rebate, "the protocol keeps the rest of the taker fee");
        eq(f.base, makerFee, "and the maker fee");
        eq(
            acct(bob, NO).quote + acct(carol, NO).quote + f.quote,
            view_.backing(market).quote,
            "quote-if-NO claims stay exactly backed"
        );
    }

    /// @dev The rebate rounds down, the remainder staying with the protocol, and a new rate
    ///      applies from the next fill on: zero leaves the whole taker fee to the protocol.
    function testMakerRebateRoundsDownAndAppliesFromTheNextFill() public {
        useFees(0, 7);
        useRebate(3_333);
        uint256 bid = rest(carol, NO, false, false, 15_001, 3 * NVDA);
        // Each fill trades 150.01 USDC, a 105,007 taker fee at 7 bps.
        take(bob, NO, true, false, 15_001, NVDA, one(uint32(bid)));
        eq(acct(carol, NO).quote, 34_998, "a third of the fee, rounded down");
        eq(view_.fees(market, NO).quote, 105_007 - 34_998, "the protocol keeps the remainder");

        useRebate(0);
        take(bob, NO, true, false, 15_001, NVDA, one(uint32(bid)));
        eq(acct(carol, NO).quote, 34_998, "no rebate once it is zero");
        eq(view_.fees(market, NO).quote, 2 * 105_007 - 34_998, "the protocol keeps the fee");

        useRebate(5_000);
        take(bob, NO, true, false, 15_001, NVDA, one(uint32(bid)));
        eq(acct(carol, NO).quote, 34_998 + 52_503, "half of the next fee, rounded down");
        eq(view_.fees(market, NO).quote, 3 * 105_007 - 34_998 - 52_503, "and the protocol the rest");
    }

    /// @dev One taker filling three makers: each maker gets its share of the fee its own fill
    ///      charged, which carries the taker's fee remainder from fill to fill.
    function testEachFilledMakerGetsTheRebateOnItsOwnFill() public {
        useFees(0, 9);
        useRebate(5_000);
        address[3] memory owners = [carol, bot, alice];
        uint64[3] memory ticks = [uint64(15_001), 15_003, 15_015];
        uint256 qty = 7e15;
        uint256[] memory seqs = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            seqs[i] = uint32(rest(owners[i], YES, false, false, ticks[i], qty));
        }
        take(bob, YES, true, false, 15_000, 3 * qty, makers(seqs));

        uint256 carry;
        uint256 kept;
        uint256 lastFee;
        for (uint256 i; i < 3; ++i) {
            uint256 n = qty * (uint256(ticks[i]) * TICK) / WAD * 9 + carry;
            (lastFee, carry) = (n / 10_000, n % 10_000);
            eq(acct(owners[i], YES).quote, lastFee / 2, "each maker: half its own fill's fee");
            kept += lastFee - lastFee / 2;
        }
        eq(lastFee, 946, "the carried remainder raised the last fill's fee");
        eq(view_.fees(market, YES).quote, kept, "the protocol keeps the rest of every fee");
    }

    /// @dev Matching one's own order pays the whole taker fee and gets back at most half of it:
    ///      even at the largest rebate, trading against oneself always loses.
    function testSelfMatchLosesEvenAtTheLargestRebate() public {
        useFees(0, 30);
        useRebate(5_000);
        _split(alice, 1, 10 * NVDA);
        _split(alice, 0, 1_000e6);
        uint256 ask = rest(alice, YES, true, true, 20_000, NVDA);
        take(alice, YES, false, true, 20_000, NVDA, one(uint32(ask)));

        uint256 takerFee = NVDA * 30 / 10_000;
        eq(acct(alice, YES).base, 10 * NVDA - takerFee / 2, "she is left half a fee short");
        eq(acct(alice, YES).quote, 1_000e6, "and gains nothing in quote");
        eq(view_.fees(market, YES).base, takerFee / 2, "which the protocol keeps");
    }

    function testOnlyTheMarketAdminSetsARebateOfUpToHalfTheTakerFee() public {
        useFees(10, 30);
        eq(view_.feeRates(market).rebateBps, 0, "a market starts without a rebate");
        vm.expectRevert(ConditionalStocksBase.Unauthorized.selector);
        vm.prank(admin);
        view_.setMakerRebate(market, 1_000);
        vm.expectRevert(ConditionalStocksBase.FeeCap.selector);
        vm.prank(marketAdmin);
        view_.setMakerRebate(market, 5_001);
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        vm.prank(marketAdmin);
        view_.setMakerRebate(999, 1_000);

        vm.recordLogs();
        useRebate(5_000);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        eq(logs.length, 1, "one event");
        ok(logs[0].topics[0] == keccak256("MakerRebateSet(uint32,uint16)"), "MakerRebateSet");
        eq(uint256(logs[0].topics[1]), market, "for the market");
        eq(abi.decode(logs[0].data, (uint256)), 5_000, "with the new rate");
        ConditionalStocksBase.FeeRates memory r = view_.feeRates(market);
        eq(r.rebateBps, 5_000, "stored");
        eq(r.makerBps, 10, "the maker rate is untouched");
        eq(r.takerBps, 30, "the taker rate is untouched");
    }

    function _lastTradeFees() internal returns (uint256 fees) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i != 0; --i) {
            if (logs[i - 1].topics[0] == TRADE_EVENT) {
                (,, fees) = abi.decode(logs[i - 1].data, (uint256, uint256, uint256));
                return fees;
            }
        }
        revert("no Trade event");
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
        useFees(10, 20);
        _split(bob, 1, 10 * NVDA);
        // Resting places no fill, so a cap below the market's maker rate is accepted...
        O memory lowCap = O(market, YES, true, true, false, 5, uint40(T0 + 1 days), 20_000, NVDA);
        uint256 seq = seqOf(market, YES);
        vm.prank(bob);
        uint256 ask = cs.place(pack(lowCap), plan(seq, now_() + 60, 0), 0);
        // ...but such a maker never fills.
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
