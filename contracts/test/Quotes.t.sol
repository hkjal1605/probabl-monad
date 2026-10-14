// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksAdmin } from "../src/ConditionalStocksAdmin.sol";
import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base, Vm } from "./Base.t.sol";

/// @dev RFQ quotes: a maker's signed price, filled inside the taker's placement without resting.
contract QuotesTest is Base {
    uint256 internal constant KEY = 0xA11CE5;
    uint256 internal constant NVDA = 1e18;
    address internal quoter;
    ConditionalStocksAdmin internal positions;

    function setUp() public override {
        super.setUp();
        useFees(5, 10);
        useRebate(2_500);
        quoter = vm.addr(KEY);
        fund(quoter, 1_000_000e6, 10_000e18);
        positions = ConditionalStocksAdmin(address(cs));
        // Everyone holds claims on both branches, for claim-funded orders.
        for (uint256 i; i < 4; ++i) {
            address user = [alice, bob, carol, quoter][i];
            vm.startPrank(user);
            positions.split(market, 0, 100_000e6);
            positions.split(market, 1, 1_000e18);
            vm.stopPrank();
        }
    }

    function _one(ConditionalStocksBase.Quote memory q)
        internal
        pure
        returns (ConditionalStocksBase.Quote[] memory list)
    {
        list = new ConditionalStocksBase.Quote[](1);
        list[0] = q;
    }

    struct Snapshot {
        uint256 makerQuote;
        uint256 makerBase;
        uint256 takerQuote;
        uint256 takerBase;
        ConditionalStocksBase.Account makerYes;
        ConditionalStocksBase.Account makerNo;
        ConditionalStocksBase.Account takerYes;
        ConditionalStocksBase.Account takerNo;
    }

    function _snap(address maker, address taker) internal view returns (Snapshot memory s) {
        s.makerQuote = credit(maker, address(usdc));
        s.makerBase = credit(maker, address(stock));
        s.takerQuote = credit(taker, address(usdc));
        s.takerBase = credit(taker, address(stock));
        s.makerYes = acct(maker, YES);
        s.makerNo = acct(maker, NO);
        s.takerYes = acct(taker, YES);
        s.takerNo = acct(taker, NO);
    }

    function _same(Snapshot memory a, Snapshot memory b) internal pure {
        eq(a.makerQuote, b.makerQuote, "maker quote credit");
        eq(a.makerBase, b.makerBase, "maker base credit");
        eq(a.takerQuote, b.takerQuote, "taker quote credit");
        eq(a.takerBase, b.takerBase, "taker base credit");
        ConditionalStocksBase.Account[4] memory x = [a.makerYes, a.makerNo, a.takerYes, a.takerNo];
        ConditionalStocksBase.Account[4] memory y = [b.makerYes, b.makerNo, b.takerYes, b.takerNo];
        for (uint256 i; i < 4; ++i) {
            eq(x[i].quote, y[i].quote, "quote claims");
            eq(x[i].base, y[i].base, "base claims");
            eq(x[i].notional, y[i].notional, "open notional");
        }
    }

    /// @dev Filling a quote moves exactly what filling the same resting order moves: every
    ///      balance and claim of both sides, the market's fees (rebate included) and its backing.
    function testFuzzQuoteFillMatchesRestingFill(
        bool takerSells,
        bool makerClaim,
        bool takerClaim,
        uint64 ticks,
        uint64 slack,
        uint256 steps
    ) public {
        ticks = uint64(1_000 + ticks % 200_000);
        steps = 1 + steps % 2_000;
        uint256 qty = steps * STEP;
        uint64 limit =
            takerSells ? ticks - uint64(slack % (ticks / 2)) : ticks + uint64(slack % 5_000);
        // Both orders meet the market's minimum notional at their own prices.
        vm.assume(qty * (limit < ticks ? limit : ticks) * TICK / WAD >= 1e6);
        ConditionalStocksBase.Fees memory f0 = view_.fees(market, YES);
        ConditionalStocksBase.Backing memory b0 = view_.backing(market);

        // Carol rests the order; Alice takes it.
        uint256 resting = rest(carol, YES, !takerSells, makerClaim, ticks, qty);
        take(alice, YES, takerSells, takerClaim, limit, qty, one(uint32(resting)));
        ConditionalStocksBase.Fees memory f1 = view_.fees(market, YES);
        ConditionalStocksBase.Backing memory b1 = view_.backing(market);

        // The quoter quotes the same; Bob takes it.
        vm.recordLogs();
        takeQuotes(
            bob,
            YES,
            takerSells,
            takerClaim,
            limit,
            qty,
            _one(signedQuote(KEY, bob, YES, !takerSells, makerClaim, ticks, qty, 7, qty)),
            0
        );
        ConditionalStocksBase.Fees memory f2 = view_.fees(market, YES);
        ConditionalStocksBase.Backing memory b2 = view_.backing(market);

        _same(_snap(carol, alice), _snap(quoter, bob));
        eq(f2.quote - f1.quote, f1.quote - f0.quote, "quote fees");
        eq(f2.base - f1.base, f1.base - f0.base, "base fees");
        eq(b2.quote - b1.quote, b1.quote - b0.quote, "quote backing");
        eq(b2.base - b1.base, b1.base - b0.base, "base backing");
        // One QuoteFilled, laid out as a Trade with the quote marker as its maker sequence.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 fills;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != ConditionalStocksBase.QuoteFilled.selector) continue;
            fills++;
            (uint256 fill,,) = abi.decode(logs[i].data, (uint256, uint256, uint256));
            eq(fill & ((1 << 96) - 1), qty, "fill quantity");
            eq(fill >> 96 & type(uint32).max, type(uint32).max, "quote marker");
            eq(fill >> 168 & 0xff, makerClaim ? 1 : 0, "funding");
            eq(fill >> 176, ticks, "ticks");
            eq(uint256(logs[i].topics[2]), uint256(uint160(quoter)), "maker topic");
        }
        eq(fills, 1, "QuoteFilled events");
    }

    function testQuoteFillsOnceAndOnlyBeforeItsExpiry() public {
        ConditionalStocksBase.Quote memory q =
            signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 1, NVDA);
        ConditionalStocksBase.Account memory before = acct(alice, YES);
        takeQuotes(alice, YES, false, false, 20_000, NVDA, _one(q), 0);
        ok(acct(alice, YES).base > before.base, "first use fills");
        // Replayed: skipped, so the order fills nothing and releases.
        ConditionalStocksBase.Account memory once = acct(alice, YES);
        takeQuotes(alice, YES, false, false, 20_000, NVDA, _one(q), 0);
        eq(acct(alice, YES).base, once.base, "a used nonce fills nothing");
        // Another nonce of the same word fills.
        takeQuotes(
            alice,
            YES,
            false,
            false,
            20_000,
            NVDA,
            _one(signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 2, NVDA)),
            0
        );
        ok(acct(alice, YES).base > once.base, "a fresh nonce fills");
        // Past its expiry a quote is skipped.
        ConditionalStocksBase.Quote memory late =
            signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 3, NVDA);
        vm.warp(now_() + 61);
        uint256 held = acct(alice, YES).base;
        takeQuotes(alice, YES, false, false, 20_000, NVDA, _one(late), 0);
        eq(acct(alice, YES).base, held, "an expired quote fills nothing");
    }

    function testQuoteForAnotherTakerOrBeyondTheMakersBalanceFillsNothing() public {
        // Signed for Alice: for Bob it recovers another, empty wallet.
        ConditionalStocksBase.Quote memory forAlice =
            signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 1, NVDA);
        ConditionalStocksBase.Account memory quoterBefore = acct(quoter, YES);
        uint256 bobBefore = acct(bob, YES).base;
        takeQuotes(bob, YES, false, false, 20_000, NVDA, _one(forAlice), 0);
        eq(acct(bob, YES).base, bobBefore, "bob got nothing");
        eq(acct(quoter, YES).base, quoterBefore.base, "quoter untouched");
        // More than the quoter holds: skipped.
        vm.prank(quoter);
        positions.transferClaim(market, YES, 1, carol, quoterBefore.base - NVDA / 2);
        uint256 aliceBefore = acct(alice, YES).base;
        ConditionalStocksBase.Quote memory big =
            signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 2, NVDA);
        takeQuotes(alice, YES, false, false, 20_000, NVDA, _one(big), 0);
        eq(acct(alice, YES).base, aliceBefore, "nothing from a short quoter");
        eq(acct(quoter, YES).base, NVDA / 2, "short quoter untouched");
    }

    function testMisplannedQuotesRevert() public {
        ConditionalStocksBase.Quote[] memory list = new ConditionalStocksBase.Quote[](1);
        // The wrong branch, the taker's own side, a price beyond the limit, more than signed, or
        // off the step.
        list[0] = signedQuote(KEY, alice, NO, true, true, 20_000, NVDA, 1, NVDA);
        _reverts(list, 20_000, NVDA);
        list[0] = signedQuote(KEY, alice, YES, false, true, 20_000, NVDA, 1, NVDA);
        _reverts(list, 20_000, NVDA);
        list[0] = signedQuote(KEY, alice, YES, true, true, 20_001, NVDA, 1, NVDA);
        _reverts(list, 20_000, NVDA);
        list[0] = signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 1, 2 * NVDA);
        _reverts(list, 20_000, 2 * NVDA);
        list[0] = signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 1, NVDA - 1);
        _reverts(list, 20_000, NVDA);
        // More than eight quotes.
        ConditionalStocksBase.Quote[] memory many = new ConditionalStocksBase.Quote[](9);
        O memory o = O(market, YES, false, false, true, 1_000, uint40(T0 + 10 days), 20_000, NVDA);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.prank(alice);
        vm.expectRevert(ConditionalStocksBase.InvalidOrder.selector);
        cs.placeWithQuotes(alice, pack(o), p, 0, many);
    }

    function _reverts(ConditionalStocksBase.Quote[] memory list, uint64 limit, uint256 qty)
        internal
    {
        O memory o = O(market, YES, false, false, true, 1_000, uint40(T0 + 10 days), limit, qty);
        uint256 order = pack(o);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.prank(alice);
        vm.expectRevert(ConditionalStocksBase.StalePlan.selector);
        cs.placeWithQuotes(alice, order, p, 0, list);
    }

    /// @dev Quotes fill first, each up to its award; the book's makers then take the rest. So an
    ///      award better than the book is never crowded out by a worse resting order.
    function testQuotesFillTheirAwardsBeforeTheBook() public {
        uint256 ask = rest(carol, YES, true, true, 20_100, 2 * NVDA);
        uint256 before = acct(alice, YES).base;
        takeQuotes(
            alice,
            YES,
            false,
            false,
            20_200,
            2 * NVDA,
            _one(signedQuote(KEY, alice, YES, true, true, 20_050, 5 * NVDA, 1, NVDA)),
            one(uint32(ask))
        );
        // 1 from the quote (at 20_050), 1 from Carol (at 20_100), both less the 10 bps taker fee.
        eq(acct(alice, YES).base - before, 2 * NVDA - 2 * NVDA * 10 / 10_000, "two filled");
        ConditionalStocksBase.Order memory left;
        (left,) = view_.order(ask);
        eq(left.remaining, NVDA, "carol keeps one");
    }

    function testDelegateTakesQuotesWithinItsGrant() public {
        vm.prank(alice);
        view_.approveDelegate(bot, 0, uint40(T0 + 7 days), 1e10, 1e11, 1e20, 1e21, 1_000, 1);
        O memory o = O(market, YES, false, false, true, 1_000, uint40(T0 + 7 days), 20_000, NVDA);
        uint256 before = acct(alice, YES).base;
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        ConditionalStocksBase.Quote[] memory list =
            _one(signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 1, NVDA));
        vm.prank(bot);
        cs.placeWithQuotes(alice, pack(o), p, 0, list);
        ok(acct(alice, YES).base > before, "filled for alice");
        ConditionalStocksBase.Grant memory g = view_.grant(alice, bot);
        eq(g.remainingQuote, 1e11 - NVDA * 20_000 * TICK / WAD, "grant charged");
        // Without a grant, another wallet cannot take quotes for Alice.
        p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.prank(carol);
        vm.expectRevert(ConditionalStocksBase.DelegationInactive.selector);
        cs.placeWithQuotes(alice, pack(o), p, 0, list);
    }

    function testTakerFeeCapCoversQuoteFills() public {
        O memory o = O(market, YES, false, false, true, 9, uint40(T0 + 10 days), 20_000, NVDA);
        ConditionalStocksBase.Quote[] memory list =
            _one(signedQuote(KEY, alice, YES, true, true, 20_000, NVDA, 1, NVDA));
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        vm.prank(alice);
        vm.expectRevert(ConditionalStocksBase.FeeCap.selector);
        cs.placeWithQuotes(alice, pack(o), p, 0, list);
    }
}
