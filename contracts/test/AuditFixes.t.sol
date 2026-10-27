// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ConditionalStocksAdmin } from "../src/ConditionalStocksAdmin.sol";
import { ConditionalStocksBase } from "../src/ConditionalStocksBase.sol";
import { Base } from "./Base.t.sol";

interface VmStorage {
    function load(address target, bytes32 slot) external view returns (bytes32);
    function store(address target, bytes32 slot, bytes32 value) external;
}

/// @dev Regressions for the exchange findings of the September 2026 audit: each test fails on
///      the audited code and passes on the fix.
contract AuditFixesTest is Base {
    VmStorage internal constant vms =
        VmStorage(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant NVDA = 1e18;
    /// Storage slots, from `forge inspect ConditionalStocks storageLayout`.
    uint256 internal constant BOOKS_SLOT = 9;
    uint256 internal constant TRADERS_SLOT = 17;

    // ------------------------------------------------------------ G-01: delegated sells

    function _grant(uint128 perOrderBase, uint128 totalBase) internal {
        vm.prank(alice);
        view_.approveDelegate(
            bot, 0, uint40(T0 + 7 days), 1_000e6, 10_000e6, perOrderBase, totalBase, 100, 1
        );
    }

    function _sellFor(address owner, uint64 ticks, uint256 qty, uint256 m) internal {
        _sellFor(owner, ticks, qty, m, bytes4(0));
    }

    /// @dev Reads the book before arming `err`, which applies to the next call.
    function _sellFor(address owner, uint64 ticks, uint256 qty, uint256 m, bytes4 err) internal {
        O memory o = O(market, YES, true, false, m != 0, 100, uint40(T0 + 1 days), ticks, qty);
        uint256 p = plan(seqOf(market, YES), now_() + 60, 0);
        if (err != bytes4(0)) vm.expectRevert(err);
        vm.prank(bot);
        cs.placeFor(owner, pack(o), p, m);
    }

    function testDelegatedSellsSpendTheShareBudget() public {
        _grant(10e18, 25e18);
        _sellFor(alice, 20_000, 10 * NVDA, 0);
        ConditionalStocksBase.Grant memory g = view_.grant(alice, bot);
        eq(g.remainingBase, 15 * NVDA, "a sell spends its quantity");
        eq(g.remainingQuote, 10_000e6, "a sell leaves the quote budget alone");
        _sellFor(alice, 20_000, 11 * NVDA, 0, ConditionalStocksBase.DelegateBudget.selector); // above the per-order limit
        _sellFor(alice, 20_000, 10 * NVDA, 0);
        _sellFor(alice, 20_000, 10 * NVDA, 0, ConditionalStocksBase.DelegateBudget.selector); // above the 5 shares left
    }

    function testBuyOnlyGrantCannotSell() public {
        _grant(0, 0);
        _sellFor(alice, 20_000, NVDA, 0, ConditionalStocksBase.DelegateBudget.selector);
    }

    /// @dev The audit's attack: the key rests its own one-tick bid and dumps the owner's stock
    ///      into it. The owner can now lose at most the approved share budget.
    function testDustPriceSellsAreBoundedByTheShareLimit() public {
        _grant(100e18, 200e18);
        uint256 bid = rest(bot, YES, false, false, 1, 1_000 * NVDA);
        _sellFor(
            alice, 1, 1_000 * NVDA, one(uint32(bid)), ConditionalStocksBase.DelegateBudget.selector
        );
        _sellFor(alice, 1, 100 * NVDA, one(uint32(bid)));
        _sellFor(alice, 1, 100 * NVDA, one(uint32(bid)));
        _sellFor(
            alice, 1, 100 * NVDA, one(uint32(bid)), ConditionalStocksBase.DelegateBudget.selector
        );
        eq(credit(alice, address(stock)), 10_000 * NVDA - 200 * NVDA, "loss capped at 200 shares");
    }

    // ------------------------------------------------------------ M-1: market cap

    /// @dev The audit's attack: one-step asks priced so each notional is a full `maxOrder`.
    function testDustAsksDoNotUseTheMarketCap() public {
        uint64 ticks = uint64(1e11 * WAD / (uint256(STEP) * TICK));
        vm.startPrank(bob);
        for (uint256 i; i < 10; ++i) {
            O memory o =
                O(market, YES, true, false, false, 1_000, uint40(T0 + 10 days), ticks, STEP);
            cs.place(pack(o), plan(seqOf(market, YES), now_() + 60, 0), 0);
        }
        vm.stopPrank();
        eq(acct(bob, YES).notional, 1e12, "the asks fill bob's own wallet cap");
        eq(view_.book(market).openNotional, 0, "but none of the shared market cap");
        rest(alice, YES, false, false, 19_000, NVDA); // others still quote
    }

    function testBidsStillUseTheMarketCap() public {
        ConditionalStocksBase.MarketParams memory p = params(uint40(T0 - 1), uint40(T0 + 30 days));
        p.maxOrder = 100e6;
        p.maxWallet = 100e6;
        p.maxMarket = 200e6;
        p.metadataHash = keccak256(bytes("ipfs://small"));
        vm.prank(marketAdmin);
        uint32 small = view_.createMarket(p, "ipfs://small");
        vm.prank(marketAdmin);
        view_.lifecycle(small, 0, bytes32(0));
        _restIn(small, alice, false, 10_000, 100 * NVDA / 100); // $100 bid
        _restIn(small, bob, false, 10_000, 100 * NVDA / 100);
        eq(view_.book(small).openNotional, 200e6, "bids fill the cap");
        _restIn(small, carol, false, 10_000, NVDA / 100, ConditionalStocksBase.CapExceeded.selector);
        _restIn(small, carol, true, 20_000, NVDA / 2); // asks are not capped by it
    }

    function _restIn(uint32 id, address user, bool sell, uint64 ticks, uint256 qty) internal {
        _restIn(id, user, sell, ticks, qty, bytes4(0));
    }

    function _restIn(uint32 id, address user, bool sell, uint64 ticks, uint256 qty, bytes4 err)
        internal
    {
        O memory o = O(id, YES, sell, false, false, 1_000, uint40(T0 + 10 days), ticks, qty);
        ConditionalStocksBase.Book memory b = view_.book(id);
        uint256 p = plan(b.seqYes, now_() + 60, 0);
        if (err != bytes4(0)) vm.expectRevert(err);
        vm.prank(user);
        cs.place(pack(o), p, 0);
    }

    // ------------------------------------------------------------ M-2: stale plans

    function _bid(address user, uint64 ticks, uint256 nextSeq) internal returns (uint256) {
        return _bid(user, ticks, nextSeq, bytes4(0));
    }

    function _bid(address user, uint64 ticks, uint256 nextSeq, bytes4 err)
        internal
        returns (uint256)
    {
        O memory o = O(market, YES, false, false, false, 1_000, uint40(T0 + 10 days), ticks, NVDA);
        uint256 p = plan(nextSeq, now_() + 60, 0);
        if (err != bytes4(0)) vm.expectRevert(err);
        vm.prank(user);
        return cs.place(pack(o), p, 0);
    }

    /// @dev The audit's attack: an unfunded address sends 17 no-fill immediate-or-cancel orders.
    function testNoFillSpamCannotFailARestingOrder() public {
        uint256 planned = seqOf(market, YES);
        address spammer = address(0xBAD);
        for (uint256 i; i < 17; ++i) {
            O memory o =
                O(market, YES, false, false, true, 1_000, uint40(T0 + 1 days), 19_000, NVDA);
            vm.prank(spammer);
            cs.place(pack(o), plan(seqOf(market, YES), now_() + 60, 0), 0);
        }
        _bid(alice, 19_000, planned); // rests
    }

    function testACrossingOrderPlacedSinceThePlanStillFailsIt() public {
        uint256 planned = seqOf(market, YES);
        vm.prank(bob);
        ConditionalStocksAdmin(address(cs)).split(market, 1, NVDA);
        rest(bob, YES, true, true, 19_000, NVDA);
        _bid(alice, 19_500, planned, ConditionalStocksBase.StalePlan.selector);
    }

    /// @dev A plan older than RECENT placements is checked against the newest ones only: it
    ///      rests, possibly crossed, instead of failing. The newest placements are always seen.
    function testAVeryStalePlanIsCheckedAgainstTheNewestPlacements() public {
        vm.prank(bob);
        ConditionalStocksAdmin(address(cs)).split(market, 1, 40 * NVDA);
        uint256 planned = seqOf(market, YES);
        rest(bob, YES, true, true, 19_000, NVDA); // crosses, but 17 placements back
        for (uint256 i; i < 16; ++i) {
            rest(bob, YES, true, true, uint64(30_000 + i), NVDA);
        }
        _bid(alice, 19_500, planned);

        planned = seqOf(market, YES);
        for (uint256 i; i < 15; ++i) {
            rest(bob, YES, true, true, uint64(31_000 + i), NVDA);
        }
        rest(bob, YES, true, true, 19_000, NVDA); // the newest placement crosses
        _bid(carol, 19_500, planned, ConditionalStocksBase.StalePlan.selector);
    }

    // ------------------------------------------------------------ L-1: sequence wrap

    function testSequenceCannotWrap() public {
        bytes32 slot = keccak256(abi.encode(uint256(market), BOOKS_SLOT));
        uint256 word = uint256(vms.load(address(cs), slot));
        word = word & ~(uint256(type(uint32).max) << 64) | uint256(type(uint32).max) << 64;
        vms.store(address(cs), slot, bytes32(word));
        eq(seqOf(market, YES), type(uint32).max, "seqYes set to the last value");
        _bid(alice, 19_000, type(uint32).max, ConditionalStocksBase.Overflow.selector);
    }

    // ------------------------------------------------------------ G-04 and G-05: lifecycle

    function _commitment(uint8 yes, uint8 no) internal view returns (bytes32) {
        return view_.resolutionHash(market, yes, no, keccak256("evidence"), "ipfs://evidence");
    }

    function testAWrongCommitmentCanBeReplaced() public {
        vm.prank(guardian);
        view_.lifecycle(market, 1, "halt");
        vm.startPrank(marketAdmin);
        view_.lifecycle(market, 3, keccak256("a mistyped commitment"));
        view_.lifecycle(market, 3, _commitment(0, 1)); // replaced while awaiting
        vm.stopPrank();
        vm.prank(resolver);
        view_.resolve(market, 0, 1, keccak256("evidence"), "ipfs://evidence");
        eq(view_.terms(market).state, 6, "redeemable");
    }

    function testAFrozenMarketReopensBeforeItsCutoff() public {
        vm.prank(guardian);
        view_.lifecycle(market, 1, "halt");
        vm.prank(marketAdmin);
        view_.lifecycle(market, 0, bytes32(0));
        eq(view_.terms(market).state, 2, "open again");
        rest(alice, YES, false, false, 19_000, NVDA);
    }

    function testReopeningNeedsNoCommitmentAndTimeBeforeTheCutoff() public {
        vm.prank(guardian);
        view_.lifecycle(market, 1, "halt");
        bytes32 commitment = _commitment(1, 0);
        vm.prank(marketAdmin);
        view_.lifecycle(market, 3, commitment);
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        vm.prank(marketAdmin);
        view_.lifecycle(market, 0, bytes32(0));

        uint32 other = createMarket(uint40(T0 - 1), uint40(T0 + 1 days));
        vm.prank(marketAdmin);
        view_.lifecycle(other, 0, bytes32(0));
        vm.warp(T0 + 1 days);
        view_.lifecycle(other, 2, bytes32(0)); // frozen at its cutoff
        vm.expectRevert(ConditionalStocksBase.InvalidState.selector);
        vm.prank(marketAdmin);
        view_.lifecycle(other, 0, bytes32(0));
    }

    // ------------------------------------------------------------ one-slot orders

    function testOrderViewReportsThePlacementEpochAndOwner() public {
        vm.prank(alice);
        view_.invalidateOrders();
        uint256 k = _bid(alice, 19_000, seqOf(market, YES));
        vm.prank(alice);
        view_.invalidateOrders();
        (ConditionalStocksBase.Order memory o, address d) = view_.order(k);
        ok(o.owner == alice && d == address(0), "owner");
        eq(o.remaining, NVDA, "remaining");
        eq(o.ticks, 19_000, "ticks");
        eq(o.epoch, 1, "placement epoch, not the current one");
        eq(view_.trader(alice).epoch, 2, "current epoch");
        ok(view_.trader(alice).id != 0, "resting trader has an id");
    }

    /// @dev Stored epochs keep 24 bits; the view widens them against the current epoch.
    function testOrderViewWidensEpochsBeyond24Bits() public {
        bytes32 slot = keccak256(abi.encode(alice, TRADERS_SLOT));
        uint256 epoch = (1 << 24) + 5;
        vms.store(address(cs), slot, bytes32(epoch));
        uint256 k = _bid(alice, 19_000, seqOf(market, YES));
        vm.prank(alice);
        view_.invalidateOrders();
        (ConditionalStocksBase.Order memory o,) = view_.order(k);
        eq(o.epoch, epoch, "placement epoch above 2^24");
        // The invalidated order no longer fills: it is released by anyone.
        vm.prank(carol);
        cs.cancel(k);
    }

    function testRestingOrdersViewMatchesOrder() public {
        uint256 a = _bid(alice, 19_000, seqOf(market, YES));
        uint256 b = _bid(bob, 18_000, seqOf(market, YES));
        vm.prank(bob);
        cs.cancel(b);
        uint256[] memory keys = new uint256[](2);
        keys[0] = a;
        keys[1] = b;
        ConditionalStocksBase.Resting[] memory r = view_.restingOrders(keys);
        eq(r[0].remaining, NVDA, "open order");
        eq(r[0].ticks, 19_000, "ticks");
        eq(r[1].remaining, 0, "closed order");
    }
}
